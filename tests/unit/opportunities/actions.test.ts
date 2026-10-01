import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpportunity } from "@/lib/opportunities/actions";

/*
 * Server Action del alta (H1.2), sin base de datos: el orden de la cadena
 * (requireTenant() → validar → escribir con ese mismo contexto → revalidar)
 * y qué le llega a la escritura. La escritura real, RLS y la deduplicación
 * se prueban contra PostgreSQL en tests/db/create-opportunity.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  write: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/create-opportunity", () => ({
  createOpportunityWithContact: mocks.write,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.write.mockReset();
  mocks.write.mockImplementation(async () => {
    mocks.calls.push("write");
    return {
      opportunityId: "30000000-0000-4000-8000-000000000001",
      contact: {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Lucía Ortiz",
        reused: false,
      },
    };
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

const VALID = {
  name: "Lucía Ortiz",
  phone: "0981 555 214",
  city: "Luque",
  source: "showroom",
  interestModel: "Toyota Corolla Cross",
  interestVersion: "",
};

describe("createOpportunity()", () => {
  it("requireTenant() → escritura con ese contexto → revalidar /opportunities", async () => {
    const state = await createOpportunity(null, form(VALID));

    expect(mocks.calls).toEqual(["requireTenant", "write", "revalidatePath"]);
    expect(mocks.write).toHaveBeenCalledWith(CTX, {
      contact: {
        name: "Lucía Ortiz",
        phone: "0981 555 214",
        phoneNormalized: "+595981555214",
        city: "Luque",
      },
      source: "showroom",
      interestModel: "Toyota Corolla Cross",
      interestVersion: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/opportunities");
    expect(state).toEqual({
      status: "created",
      opportunityId: "30000000-0000-4000-8000-000000000001",
      contactName: "Lucía Ortiz",
      contactReused: false,
    });
  });

  it("sin tenant (redirect) no valida ni escribe, aunque el payload sea inválido", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/login");
    });
    await expect(createOpportunity(null, form({}))).rejects.toThrow(
      RedirectSignal,
    );
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un payload inválido no llega a la escritura", async () => {
    const state = await createOpportunity(
      null,
      form({ ...VALID, source: "manual", phone: "123" }),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { source: "invalid_source", phone: "invalid_phone" },
    });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it("tenant y etapa del payload no llegan a la escritura", async () => {
    await createOpportunity(
      null,
      form({
        ...VALID,
        organizationId: "00000000-0000-4000-8000-000000000002",
        organization_id: "00000000-0000-4000-8000-000000000002",
        stage: "negotiation",
        contactId: "10000000-0000-4000-8000-000000000009",
      }),
    );
    const [ctx, input] = mocks.write.mock.calls[0] as [unknown, object];
    expect(ctx).toBe(CTX);
    expect(JSON.stringify(input)).not.toMatch(
      /000000000002|negotiation|000000000009|organization|stage/,
    );
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "created",
      opportunityId: "x",
      contactName: "x",
      contactReused: true,
    } as const;
    const state = await createOpportunity(forgedPrevious, form({}));
    expect(state).toMatchObject({ status: "invalid" });
  });

  it("una falla al guardar no revalida ni expone detalles: vuelve lo cargado", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.write.mockImplementation(async () => {
      throw new Error(
        'Failed query: insert into "contacts" … params: Lucía Ortiz,0981 555 214',
        { cause: { code: "23514", detail: "secreto" } },
      );
    });
    try {
      const state = await createOpportunity(null, form(VALID));
      expect(state).toEqual({ status: "failed", values: VALID });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[opportunities] create failed", {
        name: "Error",
        code: "23514",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Lucía|0981|secreto|Failed query/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
