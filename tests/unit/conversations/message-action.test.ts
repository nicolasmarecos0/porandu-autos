import { beforeEach, describe, expect, it, vi } from "vitest";

import { MESSAGE_MAX_LENGTH } from "@/domains/conversations/messages";
import { addMessage } from "@/lib/conversations/actions";

/*
 * Server Action addMessage() (Hito 4, DEC-036 §6), sin base de datos.
 * Prueba el orden de la cadena (requireTenant() → leer y validar el pedido
 * con Zod → alta con ese mismo contexto → revalidar la cola y el detalle) y
 * qué le llega a la escritura. RLS, las FKs, los CHECKs, el append-only, el
 * aislamiento y el toque de la recencia se prueban contra PostgreSQL en
 * tests/db/.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  insertMessage: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/record-message", () => ({
  insertOpportunityMessage: mocks.insertMessage,
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
const MESSAGE = "50000000-0000-4000-8000-000000000001";

const VALID = {
  opportunityId: ID,
  channel: "whatsapp",
  direction: "inbound",
  content: "¿Tienen la Hilux en blanco?",
};

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.insertMessage.mockReset();
  mocks.insertMessage.mockImplementation(async () => {
    mocks.calls.push("insert");
    return { outcome: "recorded", opportunityId: ID, messageId: MESSAGE };
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

describe("addMessage()", () => {
  it("requireTenant() → alta con ese contexto → revalidar la cola y el detalle", async () => {
    const state = await addMessage(null, form(VALID));

    expect(mocks.calls).toEqual([
      "requireTenant",
      "insert",
      "revalidatePath",
      "revalidatePath",
    ]);
    expect(mocks.insertMessage).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      message: {
        channel: "whatsapp",
        direction: "inbound",
        content: "¿Tienen la Hilux en blanco?",
      },
    });
    // El mensaje mueve la recencia (DEC-036 §1): cambia la cola.
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/opportunities"],
      [`/opportunities/${ID}`],
    ]);
    expect(state).toEqual({ status: "recorded", opportunityId: ID });
  });

  it("el texto llega normalizado, canal y dirección recortados, y el id en minúsculas", async () => {
    await addMessage(
      null,
      form({
        opportunityId: ID.toUpperCase(),
        channel: " email ",
        direction: "outbound ",
        content: "  Te paso\t\tla cotización.\r\n\r\n\r\nSaludos  ",
      }),
    );
    expect(mocks.insertMessage).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      message: {
        channel: "email",
        direction: "outbound",
        content: "Te paso la cotización.\n\nSaludos",
      },
    });
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(addMessage(null, form(VALID))).rejects.toThrow(RedirectSignal);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, contacto, autor y fecha del pedido no llegan a la escritura", async () => {
    await addMessage(
      null,
      form({
        ...VALID,
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        contactId: OTHER_ORG,
        contact_id: OTHER_ORG,
        recordedBy: "x",
        recorded_by: "x",
        createdAt: "2020-01-01",
        created_at: "2020-01-01",
      }),
    );
    const [ctx, request] = mocks.insertMessage.mock.calls[0] as [
      unknown,
      { message: Record<string, unknown> } & Record<string, unknown>,
    ];
    expect(ctx).toBe(CTX);
    expect(Object.keys(request).sort()).toEqual(["message", "opportunityId"]);
    expect(Object.keys(request.message).sort()).toEqual([
      "channel",
      "content",
      "direction",
    ]);
    expect(JSON.stringify(request)).not.toMatch(/000000000002|2020/);
  });

  it.each([
    ["sin id", { ...VALID, opportunityId: "" }],
    ["un id que no es UUID", { ...VALID, opportunityId: "1" }],
    ["una inyección en el id", { ...VALID, opportunityId: `${ID}' OR '1'='1` }],
  ])(
    "un pedido con %s es not_found y no llega a la base",
    async (_, fields) => {
      expect(await addMessage(null, form(fields))).toEqual({
        status: "not_found",
      });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it.each([
    [
      "un canal fuera de la lista",
      { channel: "sms" },
      { channel: "invalid_option" },
    ],
    ["sin canal", { channel: "" }, { channel: "required" }],
    [
      "una dirección fuera de la lista",
      { direction: "incoming" },
      { direction: "invalid_option" },
    ],
    ["un texto vacío", { content: " \n\t " }, { content: "empty" }],
    [
      "un texto demasiado largo",
      { content: "a".repeat(MESSAGE_MAX_LENGTH + 1) },
      { content: "too_long" },
    ],
  ])(
    "%s vuelve como invalid, con lo tipeado, y no llega a la base",
    async (_, override, errors) => {
      const values = {
        channel: VALID.channel,
        direction: VALID.direction,
        content: VALID.content,
        ...override,
      };
      expect(
        await addMessage(null, form({ opportunityId: ID, ...values })),
      ).toEqual({ status: "invalid", errors, values });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it("el eco de un pedido inválido está acotado", async () => {
    const state = await addMessage(
      null,
      form({
        opportunityId: ID,
        channel: "x".repeat(1000),
        direction: "inbound",
        content: "a".repeat(MESSAGE_MAX_LENGTH * 10),
      }),
    );
    expect(state?.status).toBe("invalid");
    if (state?.status !== "invalid") return;
    expect(state.values.channel).toHaveLength(32);
    expect(state.values.content).toHaveLength(MESSAGE_MAX_LENGTH * 4);
  });

  it("una oportunidad inexistente o ajena es not_found y no revalida", async () => {
    mocks.insertMessage.mockImplementation(async () => ({
      outcome: "not_found",
    }));
    expect(await addMessage(null, form(VALID))).toEqual({
      status: "not_found",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = { status: "recorded", opportunityId: "x" } as const;
    expect(await addMessage(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
  });

  it("una falla al guardar no revalida, no expone detalles y devuelve lo cargado para reintentar", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insertMessage.mockImplementation(async () => {
      throw new Error(
        'Failed query: insert into "messages" … params: Cédula 1.234.567',
        {
          cause: {
            code: "23503",
            constraint_name: "messages_opportunity_fk",
            detail: "secreto",
          },
        },
      );
    });
    try {
      const values = {
        channel: "whatsapp",
        direction: "inbound",
        content: "Cédula 1.234.567",
      };
      const state = await addMessage(
        null,
        form({ opportunityId: ID, ...values }),
      );
      expect(state).toEqual({ status: "failed", values });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(
        "[conversations] add message failed",
        {
          name: "Error",
          code: "23503",
          constraint_name: "messages_opportunity_fk",
        },
      );
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Cédula|secreto|Failed query/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
