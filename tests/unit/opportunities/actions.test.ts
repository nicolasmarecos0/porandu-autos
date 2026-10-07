import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpportunity, recordDemand } from "@/lib/opportunities/actions";

/*
 * Server Actions de Opportunities, sin base de datos: el alta (H1.2) y la
 * edición de la demanda (H1.4, recordDemand()). El orden de la cadena
 * (requireTenant() → validar → escribir con ese mismo contexto → revalidar)
 * y qué le llega a la escritura. La escritura real, RLS, la deduplicación y
 * el ledger de demanda se prueban contra PostgreSQL en
 * tests/db/create-opportunity.test.ts y tests/db/record-demand.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  write: vi.fn(),
  recordDemandCapture: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/create-opportunity", () => ({
  createOpportunityWithContact: mocks.write,
}));
vi.mock("@/db/queries/demand-facts", () => ({
  recordDemandCapture: mocks.recordDemandCapture,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";
const CTX = Object.freeze({
  organizationId: ORG,
  userId: USER,
  marker: "tenant-context",
});

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
  mocks.recordDemandCapture.mockReset();
  mocks.recordDemandCapture.mockImplementation(async () => {
    mocks.calls.push("recordDemandCapture");
    return { kind: "written", facts: ["budget_max"] };
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
  brand: "Toyota",
  model: "Corolla Cross",
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
      demand: { desired_vehicle: { brand: "Toyota", model: "Corolla Cross" } },
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
      expect(state).toEqual({
        status: "failed",
        values: expect.objectContaining(VALID),
      });
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

const OPPORTUNITY = "30000000-0000-4000-8000-000000000001";
const HEAD = "40000000-0000-4000-8000-000000000001";

function demandEdit(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(name, item);
  }
  return data;
}

const VALID_EDIT = {
  opportunityId: OPPORTUNITY,
  changed: "budget_max",
  "head.budget_max": HEAD,
  "current.budget_max": HEAD,
  budgetAmount: "270.000.000",
  budgetCurrency: "PYG",
};

describe("recordDemand()", () => {
  it("requireTenant() → escritura con ese contexto, como miembro → revalidar la cola y el detalle", async () => {
    const state = await recordDemand(null, demandEdit(VALID_EDIT));

    expect(mocks.calls).toEqual([
      "requireTenant",
      "recordDemandCapture",
      "revalidatePath",
      "revalidatePath",
    ]);
    expect(mocks.recordDemandCapture).toHaveBeenCalledWith(CTX, {
      opportunityId: OPPORTUNITY,
      source: { kind: "member", userId: USER },
      items: [
        {
          op: "set",
          fact: "budget_max",
          value: { amount: "270000000.00", currency: "PYG" },
          basedOnHead: HEAD,
        },
      ],
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/opportunities"],
      [`/opportunities/${OPPORTUNITY}`],
    ]);
    expect(state).toEqual({
      status: "saved",
      opportunityId: OPPORTUNITY,
      facts: ["budget_max"],
    });
  });

  it("solo los facts modificados; vaciar un campo es Quitar; el error de carga y la nota viajan con cada acto", async () => {
    await recordDemand(
      null,
      demandEdit({
        opportunityId: OPPORTUNITY,
        changed: ["trade_in_intent", "purchase_type"],
        "head.trade_in_intent": HEAD,
        "current.trade_in_intent": HEAD,
        "head.purchase_type": "",
        "loadError.purchase_type": "on",
        tradeIn: "",
        purchaseType: "financed",
        // No modificado: se ignora aunque venga.
        budgetAmount: "1",
        note: "  Lo   confirmó por teléfono ",
      }),
    );
    expect(mocks.recordDemandCapture.mock.calls[0]?.[1]).toEqual({
      opportunityId: OPPORTUNITY,
      source: { kind: "member", userId: USER },
      items: [
        {
          op: "remove",
          fact: "trade_in_intent",
          target: HEAD,
          basedOnHead: HEAD,
          note: "Lo confirmó por teléfono",
        },
        {
          op: "set",
          fact: "purchase_type",
          value: "financed",
          basedOnHead: null,
          reason: "load_error",
          note: "Lo confirmó por teléfono",
        },
      ],
    });
  });

  it("estado, fuente, autor, reloj y organización del pedido no llegan a la escritura", async () => {
    await recordDemand(
      null,
      demandEdit({
        ...VALID_EDIT,
        status: "detected",
        source_kind: "extractor",
        recordedBy: "00000000-0000-4000-8000-00000000000c",
        recorded_at: "2020-01-01T00:00:00Z",
        organizationId: "00000000-0000-4000-8000-000000000002",
      }),
    );
    const [ctx, capture] = mocks.recordDemandCapture.mock.calls[0] as [
      unknown,
      object,
    ];
    expect(ctx).toBe(CTX);
    expect(JSON.stringify(capture)).not.toMatch(
      /detected|extractor|00000000000c|2020|000000000002/,
    );
  });

  it("sin tenant (redirect) no lee ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/login");
    });
    await expect(recordDemand(null, demandEdit(VALID_EDIT))).rejects.toThrow(
      RedirectSignal,
    );
    expect(mocks.recordDemandCapture).not.toHaveBeenCalled();
  });

  it("un id de oportunidad malformado → not_found, sin llegar a la base", async () => {
    expect(
      await recordDemand(
        null,
        demandEdit({ ...VALID_EDIT, opportunityId: "x' OR 1=1" }),
      ),
    ).toEqual({ status: "not_found" });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it("un valor inválido no llega a la escritura y vuelve con lo cargado", async () => {
    const state = await recordDemand(
      null,
      demandEdit({ ...VALID_EDIT, budgetAmount: "150.000.000,5" }),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { budgetAmount: "pyg_decimals" },
      values: expect.objectContaining({ budgetAmount: "150.000.000,5" }),
    });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it.each([
    [
      { kind: "unchanged" },
      { status: "unchanged", opportunityId: OPPORTUNITY },
      0,
    ],
    [
      { kind: "stale", facts: ["budget_max"] },
      { status: "stale", facts: ["budget_max"] },
      2,
    ],
    [
      { kind: "pending_unresolved", facts: ["budget_max"] },
      { status: "pending", facts: ["budget_max"] },
      2,
    ],
    [
      { kind: "inconsistent", facts: ["budget_max"] },
      { status: "inconsistent", facts: ["budget_max"] },
      0,
    ],
    [{ kind: "not_found" }, { status: "not_found" }, 0],
    [
      {
        kind: "invalid",
        errors: [
          { fact: "budget_max", field: "amount", error: "not_positive" },
        ],
      },
      { status: "invalid", errors: { budgetAmount: "not_positive" } },
      0,
    ],
  ])("resultado %j → %j", async (outcome, expected, revalidations) => {
    mocks.recordDemandCapture.mockImplementation(async () => outcome);
    expect(await recordDemand(null, demandEdit(VALID_EDIT))).toMatchObject(
      expected,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(revalidations);
  });

  it("una falla al guardar no revalida ni expone detalles: solo tipo, SQLSTATE y constraint", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recordDemandCapture.mockImplementation(async () => {
      throw new Error(
        'Failed query: insert into "opportunity_demand_facts" … params: Toyota,Hilux,Cédula 1.234.567',
        {
          cause: {
            code: "23514",
            constraint_name: "opportunity_demand_facts_value_check",
            detail: "Failing row contains (Cédula 1.234.567)",
          },
        },
      );
    });
    try {
      const state = await recordDemand(
        null,
        demandEdit({ ...VALID_EDIT, note: "Cédula 1.234.567" }),
      );
      expect(state).toMatchObject({
        status: "failed",
        note: "Cédula 1.234.567",
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(
        "[opportunities] record demand failed",
        {
          name: "Error",
          code: "23514",
          constraint_name: "opportunity_demand_facts_value_check",
        },
      );
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Cédula|1\.234\.567|Toyota|Failed query|Failing row/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
