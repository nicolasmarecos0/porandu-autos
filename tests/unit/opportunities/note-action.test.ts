import { beforeEach, describe, expect, it, vi } from "vitest";

import { addOpportunityNote } from "@/lib/opportunities/actions";

/*
 * Server Action addOpportunityNote() (Hito 2, DEC-033 §1), sin base de
 * datos. Prueba el orden de la cadena (requireTenant() → leer y normalizar
 * el pedido → alta con ese mismo contexto → revalidar el detalle) y qué le
 * llega a la escritura. RLS, el CHECK, el append-only y el aislamiento se
 * prueban contra PostgreSQL en tests/db/opportunity-notes.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  insertNote: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/record-opportunity-note", () => ({
  insertOpportunityNote: mocks.insertNote,
}));
vi.mock("@/db/queries/link-opportunity-vehicle", () => ({
  setOpportunityVehicle: vi.fn(),
}));
vi.mock("@/db/queries/change-opportunity-stage", () => ({
  transitionOpportunityStage: vi.fn(),
}));
vi.mock("@/db/queries/create-opportunity", () => ({
  createOpportunityWithContact: vi.fn(),
}));
vi.mock("@/db/queries/demand-facts", () => ({
  recordDemandCapture: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-00000000000a";
const CTX = Object.freeze({
  organizationId: ORG,
  userId: USER,
  marker: "tenant-context",
});
const ID = "10000000-0000-4000-8000-000000000101";
const NOTE = "40000000-0000-4000-8000-000000000001";

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.insertNote.mockReset();
  mocks.insertNote.mockImplementation(async () => {
    mocks.calls.push("insert");
    return { outcome: "recorded", opportunityId: ID, noteId: NOTE };
  });
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation(() => {
    mocks.calls.push("revalidatePath");
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("addOpportunityNote()", () => {
  it("requireTenant() → alta con ese contexto → revalidar solo el detalle", async () => {
    const state = await addOpportunityNote(
      null,
      form({ opportunityId: ID, body: "Pidió una prueba de manejo." }),
    );

    expect(mocks.calls).toEqual(["requireTenant", "insert", "revalidatePath"]);
    expect(mocks.insertNote).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      body: "Pidió una prueba de manejo.",
    });
    // Una nota no cambia la cola (ni last_activity_at): solo el detalle.
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/opportunities/${ID}`]]);
    expect(state).toEqual({ status: "recorded", opportunityId: ID });
  });

  it("el texto llega normalizado a la escritura y el id en minúsculas", async () => {
    await addOpportunityNote(
      null,
      form({
        opportunityId: ID.toUpperCase(),
        body: "  Uno\t\tdos\r\n\r\n\r\nTres  ",
      }),
    );
    expect(mocks.insertNote).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      body: "Uno dos\n\nTres",
    });
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(
      addOpportunityNote(null, form({ opportunityId: ID, body: "Hola" })),
    ).rejects.toThrow(RedirectSignal);
    expect(mocks.insertNote).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, autor y fecha del pedido no llegan a la escritura", async () => {
    await addOpportunityNote(
      null,
      form({
        opportunityId: ID,
        body: "Nota",
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        recordedBy: "x",
        recorded_by: "x",
        recordedAt: "2020-01-01",
      }),
    );
    const [ctx, request] = mocks.insertNote.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(ctx).toBe(CTX);
    expect(Object.keys(request).sort()).toEqual(["body", "opportunityId"]);
    expect(JSON.stringify(request)).not.toMatch(/000000000002|2020/);
  });

  it.each([
    ["sin id", { body: "Nota" }],
    ["un id que no es UUID", { opportunityId: "1", body: "Nota" }],
    [
      "una inyección en el id",
      { opportunityId: `${ID}' OR '1'='1`, body: "Nota" },
    ],
  ])(
    "un pedido con %s es not_found y no llega a la base",
    async (_, fields) => {
      expect(await addOpportunityNote(null, form(fields))).toEqual({
        status: "not_found",
      });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it.each([
    ["vacía", "", "empty"],
    ["en blanco", " \n\t ", "empty"],
    ["sin campo", null, "empty"],
    ["demasiado larga", "a".repeat(1001), "too_long"],
  ] as const)(
    "una nota %s vuelve como invalid, con lo tipeado, y no llega a la base",
    async (_, body, error) => {
      const fields: Record<string, string> = { opportunityId: ID };
      if (body !== null) fields.body = body;
      expect(await addOpportunityNote(null, form(fields))).toEqual({
        status: "invalid",
        error,
        body: body ?? "",
      });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it("una oportunidad inexistente o ajena es not_found y no revalida", async () => {
    mocks.insertNote.mockImplementation(async () => ({ outcome: "not_found" }));
    expect(
      await addOpportunityNote(null, form({ opportunityId: ID, body: "Nota" })),
    ).toEqual({ status: "not_found" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = { status: "recorded", opportunityId: "x" } as const;
    expect(await addOpportunityNote(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
  });

  it("una falla al guardar no revalida, no expone detalles y devuelve el texto para reintentar", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insertNote.mockImplementation(async () => {
      throw new Error(
        'Failed query: insert into "opportunity_notes" … params: Cédula 1.234.567',
        {
          cause: {
            code: "23514",
            constraint_name: "opportunity_notes_body_check",
            detail: "secreto",
          },
        },
      );
    });
    try {
      const state = await addOpportunityNote(
        null,
        form({ opportunityId: ID, body: "Cédula 1.234.567" }),
      );
      expect(state).toEqual({ status: "failed", body: "Cédula 1.234.567" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[opportunities] add note failed", {
        name: "Error",
        code: "23514",
        constraint_name: "opportunity_notes_body_check",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Cédula|secreto|Failed query/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
