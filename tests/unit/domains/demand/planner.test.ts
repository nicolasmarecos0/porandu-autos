import { describe, expect, it } from "vitest";

import {
  planDemandCapture,
  type DemandCapture,
  type DemandItem,
  type DemandPlan,
  type NewDemandRow,
} from "@/domains/demand/planner";
import { resolveDemand, type DemandRow } from "@/domains/demand/resolver";
import { demandSnapshot } from "@/domains/demand/snapshot";

import {
  at,
  detection,
  human,
  id,
  OTHER_SELLER,
  PYG,
  SELLER,
} from "../../support/demand-rows";

/*
 * Ingestion Contract (spec §6 y §7, criterios D5, D6, HP2 y HP3): el planner
 * deriva estado, target y previous de cada acto humano, nunca los acepta del
 * llamador, y aborta la captura entera ante cualquier ítem stale, con un
 * pendiente sin resolver, inválido o inconsistente.
 */

const OPPORTUNITY = "30000000-0000-4000-8000-000000000001";
const [h1, h2] = [id("h1"), id("h2")];
const [d1, d2] = [id("d1"), id("d2")];

function capture(
  items: readonly DemandItem[],
  userId: string = SELLER,
): DemandCapture {
  return {
    opportunityId: OPPORTUNITY,
    source: { kind: "member", userId },
    items,
  };
}

function rowsOf(plan: DemandPlan): readonly NewDemandRow[] {
  if (plan.kind !== "write") {
    throw new Error(`expected write, got ${JSON.stringify(plan)}`);
  }
  return plan.rows;
}

let sequence = 0;

/** Aplica un plan como lo haría la base: id nuevo y reloj de la transacción. */
function apply(
  ledger: readonly DemandRow[],
  plan: DemandPlan,
  time: string,
): DemandRow[] {
  return [
    ...ledger,
    ...rowsOf(plan).map((row) => {
      sequence += 1;
      return {
        ...row,
        id: id(`h${900 + sequence}`),
        recordedAt: at(time),
        observedAt: null,
      } as DemandRow;
    }),
  ];
}

const budget250 = human(h1, "budget_max", "confirmed", PYG("250000000"));

describe("derivación del acto humano (D5)", () => {
  it("set sobre Unknown → confirmed, sin target ni previous; el motivo se ignora", () => {
    const plan = planDemandCapture(
      [],
      capture([
        {
          op: "set",
          fact: "purchase_type",
          value: "cash",
          basedOnHead: null,
          reason: "load_error",
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      {
        fact: "purchase_type",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: SELLER,
        targetFactId: null,
        previousMemberFactId: null,
        value: "cash",
        evidenceText: null,
      },
    ]);
  });

  it("set sobre un valor humano distinto: el cliente cambió (default) → confirmed, target = vigente", () => {
    const plan = planDemandCapture(
      [budget250],
      capture([
        {
          op: "set",
          fact: "budget_max",
          value: { amount: "270000000", currency: "PYG" },
          basedOnHead: h1,
          note: "Subió el presupuesto",
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      {
        fact: "budget_max",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: SELLER,
        targetFactId: h1,
        previousMemberFactId: h1,
        value: PYG("270000000"),
        evidenceText: "Subió el presupuesto",
      },
    ]);
  });

  it("set con reason load_error sobre un valor humano → corrected (C-2)", () => {
    const plan = planDemandCapture(
      [human(h1, "budget_max", "confirmed", PYG("2500000000"))],
      capture([
        {
          op: "set",
          fact: "budget_max",
          value: { amount: "250000000", currency: "PYG" },
          basedOnHead: h1,
          reason: "load_error",
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      expect.objectContaining({
        status: "corrected",
        targetFactId: h1,
        previousMemberFactId: h1,
        value: PYG("250000000"),
      }),
    ]);
  });

  it("set con el mismo valor vigente → unchanged (no se escribe)", () => {
    expect(
      planDemandCapture(
        [budget250],
        capture([
          {
            op: "set",
            fact: "budget_max",
            value: { amount: "250000000.00", currency: "PYG" },
            basedOnHead: h1,
          },
        ]),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it("set después de quitar → confirmed sin target, previous = el retiro", () => {
    const plan = planDemandCapture(
      [
        budget250,
        human(h2, "budget_max", "rejected", null, {
          target: h1,
          previous: h1,
        }),
      ],
      capture([
        {
          op: "set",
          fact: "budget_max",
          value: { amount: "300000000", currency: "PYG" },
          basedOnHead: h2,
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      expect.objectContaining({
        status: "confirmed",
        targetFactId: null,
        previousMemberFactId: h2,
      }),
    ]);
  });

  it("remove → rejected sobre el valor humano vigente (Quitar = error de carga)", () => {
    const plan = planDemandCapture(
      [human(h1, "trade_in_intent", "confirmed", true)],
      capture([
        {
          op: "remove",
          fact: "trade_in_intent",
          target: h1,
          basedOnHead: h1,
          note: "Era de otro cliente",
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      {
        fact: "trade_in_intent",
        status: "rejected",
        sourceKind: "member",
        recordedBy: SELLER,
        targetFactId: h1,
        previousMemberFactId: h1,
        value: null,
        evidenceText: "Era de otro cliente",
      },
    ]);
  });

  it("remove sobre Unknown → unchanged; con un target que no es el vigente → invalid", () => {
    expect(
      planDemandCapture(
        [],
        capture([
          {
            op: "remove",
            fact: "trade_in_intent",
            target: h1,
            basedOnHead: null,
          },
        ]),
      ),
    ).toEqual({ kind: "unchanged" });
    expect(
      planDemandCapture(
        [human(h1, "trade_in_intent", "confirmed", true)],
        capture([
          {
            op: "remove",
            fact: "trade_in_intent",
            target: h2,
            basedOnHead: h1,
          },
        ]),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        { fact: "trade_in_intent", field: "item", error: "invalid_target" },
      ],
    });
  });

  it("el llamador no elige estado, fuente, autor ni enlaces", () => {
    const forged = {
      op: "set",
      fact: "purchase_type",
      value: "financed",
      basedOnHead: null,
      status: "detected",
      sourceKind: "extractor",
      recordedBy: OTHER_SELLER,
      recordedAt: "2020-01-01T00:00:00Z",
      previousMemberFactId: h2,
      targetFactId: h2,
      organizationId: OPPORTUNITY,
      id: h2,
    } as unknown as DemandItem;
    expect(rowsOf(planDemandCapture([], capture([forged])))).toEqual([
      {
        fact: "purchase_type",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: SELLER,
        targetFactId: null,
        previousMemberFactId: null,
        value: "financed",
        evidenceText: null,
      },
    ]);
  });

  it("varios ítems → una fila por fact, en el orden canónico", () => {
    const plan = planDemandCapture(
      [],
      capture([
        {
          op: "set",
          fact: "down_payment",
          value: { amount: "0", currency: "PYG" },
          basedOnHead: null,
        },
        { op: "set", fact: "trade_in_intent", value: false, basedOnHead: null },
        {
          op: "set",
          fact: "desired_vehicle",
          value: { brand: "Toyota", model: "Hilux" },
          basedOnHead: null,
        },
        {
          op: "set",
          fact: "year_range",
          value: { min: 2022 },
          basedOnHead: null,
        },
      ]),
    );
    expect(rowsOf(plan).map((row) => [row.fact, row.value])).toEqual([
      ["desired_vehicle", { brand: "Toyota", model: "Hilux" }],
      ["year_range", { min: 2022 }],
      ["trade_in_intent", false],
      // T26: 0 es "Sin entrega inicial".
      ["down_payment", PYG("0")],
    ]);
  });
});

describe("sobre detecciones (H2a+; filas sintéticas)", () => {
  const detected = detection(d1, "budget_max", PYG("2500000000"));
  const pendingLedger = [
    budget250,
    detection(d1, "budget_max", PYG("270000000"), { at: "14:10" }),
  ];

  it("T20: reemplazar la detección vigente con otro valor exige el motivo", () => {
    const item = {
      op: "set",
      fact: "budget_max",
      value: { amount: "250000000", currency: "PYG" },
      basedOnHead: null,
    } as const;
    expect(planDemandCapture([detected], capture([item]))).toEqual({
      kind: "invalid",
      errors: [{ fact: "budget_max", field: "item", error: "reason_required" }],
    });
    expect(
      rowsOf(
        planDemandCapture(
          [detected],
          capture([{ ...item, reason: "load_error" }]),
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        status: "corrected",
        targetFactId: d1,
        previousMemberFactId: null,
      }),
    ]);
    expect(
      rowsOf(
        planDemandCapture(
          [detected],
          capture([{ ...item, reason: "customer_changed" }]),
        ),
      ),
    ).toEqual([
      expect.objectContaining({ status: "confirmed", targetFactId: d1 }),
    ]);
  });

  it("confirmar la detección vigente con el mismo valor → confirmed sobre ella; nunca se confirma sola", () => {
    expect(
      rowsOf(
        planDemandCapture(
          [detected],
          capture([
            {
              op: "set",
              fact: "budget_max",
              value: { amount: "2500000000", currency: "PYG" },
              basedOnHead: null,
            },
          ]),
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        status: "confirmed",
        targetFactId: d1,
        value: PYG("2500000000"),
      }),
    ]);
    // Sin un acto humano, sigue siendo Detectado.
    expect(resolveDemand([detected]).budget_max.status).toBe("detected");
  });

  it("T18: accept del pendiente → confirmed con su valor, target = pendiente", () => {
    expect(
      rowsOf(
        planDemandCapture(
          pendingLedger,
          capture([
            { op: "accept", fact: "budget_max", target: d1, basedOnHead: h1 },
          ]),
        ),
      ),
    ).toEqual([
      {
        fact: "budget_max",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: SELLER,
        targetFactId: d1,
        previousMemberFactId: h1,
        value: PYG("270000000"),
        evidenceText: null,
      },
    ]);
  });

  it("reject del pendiente → rejected; la detección queda descartada y el valor humano sigue", () => {
    const plan = planDemandCapture(
      pendingLedger,
      capture([
        {
          op: "reject",
          fact: "budget_max",
          target: d1,
          basedOnHead: h1,
          note: "Lo dijo en broma",
        },
      ]),
    );
    expect(rowsOf(plan)).toEqual([
      expect.objectContaining({
        status: "rejected",
        targetFactId: d1,
        previousMemberFactId: h1,
        value: null,
      }),
    ]);
    const after = resolveDemand(apply(pendingLedger, plan, "14:20"));
    expect(after.budget_max).toMatchObject({
      value: PYG("250000000"),
      pending: null,
    });
  });

  it("después de quitar, una detección pendiente se puede descartar", () => {
    const ledger = [
      human(h1, "trade_in_intent", "confirmed", true),
      human(h2, "trade_in_intent", "rejected", null, {
        target: h1,
        previous: h1,
        at: "14:06",
      }),
      detection(d1, "trade_in_intent", true, { at: "14:10" }),
    ];
    expect(
      rowsOf(
        planDemandCapture(
          ledger,
          capture([
            {
              op: "reject",
              fact: "trade_in_intent",
              target: d1,
              basedOnHead: h2,
            },
          ]),
        ),
      ),
    ).toEqual([
      expect.objectContaining({ status: "rejected", targetFactId: d1 }),
    ]);
  });

  it("T19: editar con un pendiente sin resolver → pending_unresolved; nada se escribe", () => {
    expect(
      planDemandCapture(
        pendingLedger,
        capture([
          {
            op: "set",
            fact: "budget_max",
            value: { amount: "260000000", currency: "PYG" },
            basedOnHead: h1,
          },
        ]),
      ),
    ).toEqual({ kind: "pending_unresolved", facts: ["budget_max"] });
    expect(
      planDemandCapture(
        pendingLedger,
        capture([
          { op: "remove", fact: "budget_max", target: h1, basedOnHead: h1 },
        ]),
      ),
    ).toEqual({ kind: "pending_unresolved", facts: ["budget_max"] });
  });

  it("set con target = pendiente lo resuelve; con otro valor exige el motivo", () => {
    const item = {
      op: "set",
      fact: "budget_max",
      value: { amount: "260000000", currency: "PYG" },
      basedOnHead: h1,
      target: d1,
    } as const;
    expect(planDemandCapture(pendingLedger, capture([item]))).toMatchObject({
      kind: "invalid",
      errors: [{ error: "reason_required" }],
    });
    expect(
      rowsOf(
        planDemandCapture(
          pendingLedger,
          capture([{ ...item, reason: "load_error" }]),
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        status: "corrected",
        targetFactId: d1,
        previousMemberFactId: h1,
      }),
    ]);
  });

  it("accept o reject de algo que no es el pendiente ni la detección vigente → invalid_target", () => {
    for (const op of ["accept", "reject"] as const) {
      expect(
        planDemandCapture(
          pendingLedger,
          capture([{ op, fact: "budget_max", target: h1, basedOnHead: h1 }]),
        ),
      ).toEqual({
        kind: "invalid",
        errors: [
          { fact: "budget_max", field: "item", error: "invalid_target" },
        ],
      });
    }
  });

  it("Quitar una detección no aplica (es Rechazar)", () => {
    expect(
      planDemandCapture(
        [detected],
        capture([
          { op: "remove", fact: "budget_max", target: d1, basedOnHead: null },
        ]),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [{ fact: "budget_max", field: "item", error: "not_removable" }],
    });
  });

  it("una acción sobre una detección con el head desactualizado → stale", () => {
    const ledger = [
      ...pendingLedger,
      human(h2, "budget_max", "rejected", null, {
        target: d1,
        previous: h1,
        at: "14:15",
      }),
      detection(d2, "budget_max", PYG("280000000"), { at: "14:20" }),
    ];
    expect(
      planDemandCapture(
        ledger,
        capture([
          { op: "accept", fact: "budget_max", target: d1, basedOnHead: h1 },
        ]),
      ),
    ).toEqual({ kind: "stale", facts: ["budget_max"] });
  });
});

describe("compare-and-set: concurrencia y doble envío (HP2)", () => {
  it("T10: el mismo set dos veces con el head h1 → la segunda es unchanged", () => {
    const item = {
      op: "set",
      fact: "budget_max",
      value: { amount: "270000000", currency: "PYG" },
      basedOnHead: h1,
    } as const;
    const first = planDemandCapture([budget250], capture([item]));
    const ledger = apply([budget250], first, "14:10");
    expect(planDemandCapture(ledger, capture([item]))).toEqual({
      kind: "unchanged",
    });
  });

  it("T9: A y B parten de h1; A escribe 260M y B (270M) recibe stale; con el mismo valor, unchanged", () => {
    const a = capture([
      {
        op: "set",
        fact: "budget_max",
        value: { amount: "260000000", currency: "PYG" },
        basedOnHead: h1,
      },
    ]);
    const ledger = apply(
      [budget250],
      planDemandCapture([budget250], a),
      "14:10",
    );
    expect(
      planDemandCapture(
        ledger,
        capture(
          [
            {
              op: "set",
              fact: "budget_max",
              value: { amount: "270000000", currency: "PYG" },
              basedOnHead: h1,
            },
          ],
          OTHER_SELLER,
        ),
      ),
    ).toEqual({ kind: "stale", facts: ["budget_max"] });
    expect(
      planDemandCapture(
        ledger,
        capture(
          [
            {
              op: "set",
              fact: "budget_max",
              value: { amount: "260000000", currency: "PYG" },
              basedOnHead: h1,
            },
          ],
          OTHER_SELLER,
        ),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it("un head que no existe (cliente adulterado) → stale", () => {
    expect(
      planDemandCapture(
        [],
        capture([
          { op: "set", fact: "purchase_type", value: "cash", basedOnHead: h2 },
        ]),
      ),
    ).toEqual({ kind: "stale", facts: ["purchase_type"] });
  });
});

describe("todo o nada (D6)", () => {
  const ledger = [
    budget250,
    human(h2, "year_range", "confirmed", { min: 2018 }),
  ];

  it("T21: budget stale + year válido → stale; year no se escribe", () => {
    expect(
      planDemandCapture(
        ledger,
        capture([
          {
            op: "set",
            fact: "budget_max",
            value: { amount: "270000000", currency: "PYG" },
            basedOnHead: id("h99"),
          },
          {
            op: "set",
            fact: "year_range",
            value: { min: 2020 },
            basedOnHead: h2,
          },
        ]),
      ),
    ).toEqual({ kind: "stale", facts: ["budget_max"] });
  });

  it("un ítem inválido aborta la captura, con un error por campo", () => {
    expect(
      planDemandCapture(
        ledger,
        capture([
          {
            op: "set",
            fact: "budget_max",
            value: { amount: "150000000.5", currency: "PYG" },
            basedOnHead: h1,
          },
          {
            op: "set",
            fact: "year_range",
            value: { min: 2020 },
            basedOnHead: h2,
          },
          {
            op: "set",
            fact: "purchase_type",
            value: "cash",
            basedOnHead: null,
            note: "x".repeat(501),
          },
        ]),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        { fact: "budget_max", field: "amount", error: "pyg_decimals" },
        { fact: "purchase_type", field: "note", error: "too_long" },
      ],
    });
  });

  it("un fact inconsistente aborta la captura", () => {
    const broken = [
      ...ledger,
      human(id("h3"), "purchase_type", "confirmed", "cash"),
      human(id("h4"), "purchase_type", "confirmed", "financed"),
    ];
    expect(
      planDemandCapture(
        broken,
        capture([
          {
            op: "set",
            fact: "purchase_type",
            value: "undecided",
            basedOnHead: id("h4"),
          },
          {
            op: "set",
            fact: "year_range",
            value: { min: 2020 },
            basedOnHead: h2,
          },
        ]),
      ),
    ).toEqual({ kind: "inconsistent", facts: ["purchase_type"] });
  });

  it("facts duplicados o desconocidos → invalid", () => {
    expect(
      planDemandCapture(
        [],
        capture([
          {
            op: "set",
            fact: "purchase_type",
            value: "cash",
            basedOnHead: null,
          },
          {
            op: "set",
            fact: "purchase_type",
            value: "financed",
            basedOnHead: null,
          },
          {
            op: "set",
            fact: "version",
            value: "SRV",
            basedOnHead: null,
          } as unknown as DemandItem,
        ]),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        { fact: "purchase_type", field: "item", error: "duplicate_fact" },
        { fact: null, field: "item", error: "unknown_fact" },
      ],
    });
  });

  it("una captura vacía no escribe nada", () => {
    expect(planDemandCapture(ledger, capture([]))).toEqual({
      kind: "unchanged",
    });
  });
});

describe("oportunidad y fuente", () => {
  it("sin ledger (oportunidad inexistente o ajena) → not_found", () => {
    expect(
      planDemandCapture(
        null,
        capture([
          {
            op: "set",
            fact: "purchase_type",
            value: "cash",
            basedOnHead: null,
          },
        ]),
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("una fuente que no es un miembro (H1.4) → forbidden", () => {
    for (const source of [
      { kind: "extractor", userId: SELLER },
      { kind: "member", userId: "" },
      { kind: "member" },
      null,
    ]) {
      expect(
        planDemandCapture([], {
          opportunityId: OPPORTUNITY,
          source: source as never,
          items: [
            {
              op: "set",
              fact: "purchase_type",
              value: "cash",
              basedOnHead: null,
            },
          ],
        }),
      ).toEqual({ kind: "forbidden" });
    }
  });
});

describe("Match Contract: DemandSnapshot (spec §11)", () => {
  it("valor, estado y factId por fact; sin historial, evidencia ni pendiente", () => {
    const snapshot = demandSnapshot(
      resolveDemand([
        human(h1, "budget_max", "confirmed", PYG("250000000"), {
          note: "nota",
        }),
        detection(d1, "budget_max", PYG("270000000"), { at: "14:10" }),
        detection(d2, "purchase_type", "financed"),
        human(id("h3"), "trade_in_intent", "confirmed", true),
        human(id("h4"), "trade_in_intent", "rejected", null, {
          target: id("h3"),
          previous: id("h3"),
          at: "14:10",
        }),
      ]),
    );
    expect(snapshot).toEqual({
      desired_vehicle: { value: null, status: "unknown", factId: null },
      year_range: { value: null, status: "unknown", factId: null },
      budget_max: {
        value: PYG("250000000"),
        status: "confirmed",
        factId: h1,
      },
      purchase_type: { value: "financed", status: "detected", factId: d2 },
      trade_in_intent: { value: null, status: "unknown", factId: null },
      down_payment: { value: null, status: "unknown", factId: null },
    });
  });
});
