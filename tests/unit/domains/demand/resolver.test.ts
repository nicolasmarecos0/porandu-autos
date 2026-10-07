import { describe, expect, it } from "vitest";

import { DEMAND_FACTS } from "@/domains/demand/facts";
import {
  resolveDemand,
  resolveFact,
  type DemandRow,
  type FactTruth,
} from "@/domains/demand/resolver";

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
 * Current Truth Resolver (spec §5, criterios CT1, CT2, CT3, HP1, F1 y F2).
 * Los casos con detecciones son sintéticos: la base de H1.4 no admite filas
 * `detected`, pero el contrato tiene que estar listo para H2a/H2b.
 */

const [h1, h2, h3] = [id("h1"), id("h2"), id("h3")];
const [d1, d2, d3] = [id("d1"), id("d2"), id("d3")];

function labels(truth: FactTruth): Record<string, string> {
  return Object.fromEntries(truth.history.map((e) => [e.factId, e.label]));
}

describe("sin filas: Unknown never_captured", () => {
  it("todos los facts de la lista cerrada, sin valor ni historial", () => {
    const truth = resolveDemand([]);
    for (const fact of DEMAND_FACTS) {
      expect(truth[fact]).toMatchObject({
        fact,
        status: "unknown",
        value: null,
        factId: null,
        unknownReason: "never_captured",
        headId: null,
        pending: null,
        history: [],
      });
    }
  });
});

describe("humano vs humano: rige el último acto de la cadena", () => {
  it("T1: el cliente sube el presupuesto → 270M Confirmado, 250M Reemplazado", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      human(h2, "budget_max", "confirmed", PYG("270000000"), {
        target: h1,
        previous: h1,
        at: "14:10",
        note: "Lo confirmó por teléfono",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: PYG("270000000"),
      factId: h2,
      recordedAt: at("14:10"),
      recordedBy: SELLER,
      evidenceText: "Lo confirmó por teléfono",
      replaced: PYG("250000000"),
      unknownReason: null,
      headId: h2,
      pending: null,
    });
    expect(labels(truth)).toEqual({ [h2]: "current", [h1]: "superseded" });
  });

  it("T2: el vendedor corrige un typo (C-2) → 250M Corregido, 2500M Erróneo", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("2500000000")),
      human(h2, "budget_max", "corrected", PYG("250000000"), {
        target: h1,
        previous: h1,
        at: "14:06",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "corrected",
      value: PYG("250000000"),
      factId: h2,
      replaced: PYG("2500000000"),
    });
    expect(labels(truth)).toEqual({ [h2]: "current", [h1]: "erroneous" });
  });

  it("T12: el cliente pasa de contado a financiado", () => {
    const truth = resolveFact("purchase_type", [
      human(h1, "purchase_type", "confirmed", "cash"),
      human(h2, "purchase_type", "confirmed", "financed", {
        target: h1,
        previous: h1,
        at: "14:30",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: "financed",
      replaced: "cash",
    });
    expect(labels(truth)).toEqual({ [h2]: "current", [h1]: "superseded" });
  });

  it("el orden de los actos humanos es el de la cadena, no el del reloj", () => {
    const truth = resolveFact("trade_in_intent", [
      human(h1, "trade_in_intent", "confirmed", true, { at: "14:10" }),
      human(h2, "trade_in_intent", "confirmed", false, {
        target: h1,
        previous: h1,
        at: "14:05",
      }),
    ]);
    expect(truth).toMatchObject({ value: false, factId: h2, headId: h2 });
  });

  it("otro miembro puede cambiar la demanda que cargó otro (sin responsable)", () => {
    const truth = resolveFact("purchase_type", [
      human(h1, "purchase_type", "confirmed", "cash"),
      human(h2, "purchase_type", "confirmed", "undecided", {
        target: h1,
        previous: h1,
        by: OTHER_SELLER,
        at: "15:00",
      }),
    ]);
    expect(truth).toMatchObject({
      value: "undecided",
      recordedBy: OTHER_SELLER,
    });
  });
});

describe("quitar (C-3) y rechazar", () => {
  it("T8: quitar el valor humano → Unknown withdrawn; una detección posterior solo queda pendiente", () => {
    const ledger = [
      human(h1, "trade_in_intent", "confirmed", true),
      human(h2, "trade_in_intent", "rejected", null, {
        target: h1,
        previous: h1,
        at: "14:10",
        note: "Lo cargué en otra oportunidad",
      }),
    ];
    const withdrawn = resolveFact("trade_in_intent", ledger);
    expect(withdrawn).toMatchObject({
      status: "unknown",
      value: null,
      unknownReason: "withdrawn",
      headId: h2,
      closedBy: {
        factId: h2,
        recordedBy: SELLER,
        recordedAt: at("14:10"),
        evidenceText: "Lo cargué en otra oportunidad",
      },
      pending: null,
    });
    expect(labels(withdrawn)).toEqual({ [h2]: "rejection", [h1]: "withdrawn" });

    for (const value of [true, false]) {
      const later = resolveFact("trade_in_intent", [
        ...ledger,
        detection(d1, "trade_in_intent", value, { at: "14:20" }),
      ]);
      expect(later).toMatchObject({
        status: "unknown",
        unknownReason: "withdrawn",
        pending: { factId: d1, value, predatesAnchor: false },
      });
    }
  });

  it("T6: rechazar una detección sin humano previo → Unknown dismissed; otra detección queda pendiente (mismo u otro valor)", () => {
    const ledger = [
      detection(d1, "budget_max", PYG("270000000"), { at: "14:00" }),
      human(h1, "budget_max", "rejected", null, { target: d1, at: "14:05" }),
    ];
    expect(resolveFact("budget_max", ledger)).toMatchObject({
      status: "unknown",
      unknownReason: "dismissed",
      closedBy: { factId: h1 },
      pending: null,
    });

    for (const amount of ["270000000", "300000000"]) {
      const truth = resolveFact("budget_max", [
        ...ledger,
        detection(d2, "budget_max", PYG(amount), { at: "14:10" }),
      ]);
      expect(truth).toMatchObject({
        status: "unknown",
        unknownReason: "dismissed",
        value: null,
        pending: { factId: d2, value: PYG(amount) },
      });
      expect(labels(truth)).toEqual({
        [d2]: "pending",
        [h1]: "rejection",
        [d1]: "discarded",
      });
    }
  });

  it("T7: rechazar la última detección con otras anteriores → Unknown dismissed; d1 no reaparece", () => {
    const truth = resolveFact("budget_max", [
      detection(d1, "budget_max", PYG("250000000"), { at: "13:00" }),
      detection(d2, "budget_max", PYG("270000000"), { at: "13:30" }),
      human(h1, "budget_max", "rejected", null, { target: d2, at: "14:05" }),
    ]);
    expect(truth).toMatchObject({
      status: "unknown",
      unknownReason: "dismissed",
      value: null,
      pending: null,
    });
    expect(labels(truth)).toEqual({
      [h1]: "rejection",
      [d2]: "discarded",
      [d1]: "covered",
    });
  });

  it("rechazar una detección con un valor humano vigente no cambia el valor", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      detection(d1, "budget_max", PYG("270000000"), { at: "14:10" }),
      human(h2, "budget_max", "rejected", null, {
        target: d1,
        previous: h1,
        at: "14:15",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: PYG("250000000"),
      factId: h1,
      headId: h2,
      pending: null,
    });
  });

  it("después de quitar, un valor nuevo vuelve a ser Confirmado", () => {
    const truth = resolveFact("desired_vehicle", [
      human(h1, "desired_vehicle", "confirmed", { model: "Ranger" }),
      human(h2, "desired_vehicle", "rejected", null, {
        target: h1,
        previous: h1,
        at: "14:10",
      }),
      human(
        h3,
        "desired_vehicle",
        "confirmed",
        { model: "Hilux" },
        {
          previous: h2,
          at: "14:20",
        },
      ),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: { model: "Hilux" },
      replaced: null,
      headId: h3,
    });
  });
});

describe("máquina vs máquina, sin humano (C-1)", () => {
  it("la detección más reciente es el valor vigente, Detectado", () => {
    const truth = resolveFact("purchase_type", [
      detection(d1, "purchase_type", "cash", { at: "10:00" }),
      detection(d2, "purchase_type", "financed", { at: "11:00" }),
    ]);
    expect(truth).toMatchObject({
      status: "detected",
      value: "financed",
      factId: d2,
      headId: null,
      pending: null,
      evidenceText: "mensaje del cliente",
    });
    expect(labels(truth)).toEqual({ [d2]: "current", [d1]: "superseded" });
  });

  it("T3: una detección vieja que llega tarde no desplaza a una más nueva", () => {
    const truth = resolveFact("budget_max", [
      detection(d1, "budget_max", PYG("270000000"), {
        observed: "10:00",
        at: "10:05",
      }),
      detection(d2, "budget_max", PYG("250000000"), {
        observed: "09:00",
        at: "10:30",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "detected",
      value: PYG("270000000"),
      factId: d1,
    });
    expect(labels(truth)).toEqual({ [d2]: "superseded", [d1]: "current" });
  });

  it("empate de reloj: decide el id (determinista)", () => {
    const truth = resolveFact("trade_in_intent", [
      detection(d1, "trade_in_intent", true, { at: "10:00" }),
      detection(d2, "trade_in_intent", false, { at: "10:00" }),
    ]);
    expect(truth.factId).toBe(d2);
  });
});

describe("humano vs máquina: con intervención humana, una inferencia nunca es el valor vigente", () => {
  it("T4: detección tardía después de un humano → pendiente con predatesAnchor", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      detection(d1, "budget_max", PYG("270000000"), {
        observed: "14:00",
        at: "14:10",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: PYG("250000000"),
      factId: h1,
      pending: {
        factId: d1,
        value: PYG("270000000"),
        predatesAnchor: true,
      },
    });
    expect(labels(truth)).toEqual({ [d1]: "pending", [h1]: "current" });
  });

  it("caso del brief: 220M → el vendedor registra 230M → una detección antigua de 220M no pisa el 230M", () => {
    const ledger = [
      human(h1, "budget_max", "confirmed", PYG("220000000"), { at: "14:00" }),
      human(h2, "budget_max", "confirmed", PYG("230000000"), {
        target: h1,
        previous: h1,
        at: "14:30",
      }),
    ];
    const late = resolveFact("budget_max", [
      ...ledger,
      detection(d1, "budget_max", PYG("220000000"), {
        observed: "13:00",
        at: "15:00",
      }),
    ]);
    expect(late).toMatchObject({
      status: "confirmed",
      value: PYG("230000000"),
      factId: h2,
      pending: { factId: d1, value: PYG("220000000"), predatesAnchor: true },
    });
    // Registrada antes del último acto humano: ese acto ya la cubrió.
    const covered = resolveFact("budget_max", [
      ...ledger,
      detection(d1, "budget_max", PYG("220000000"), { at: "14:10" }),
    ]);
    expect(covered).toMatchObject({ value: PYG("230000000"), pending: null });
    expect(labels(covered)[d1]).toBe("covered");
  });

  it("T5: detecciones duplicadas con el mismo valor → sin pendiente, corroboración", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      detection(d1, "budget_max", PYG("250000000"), { at: "14:10" }),
      detection(d2, "budget_max", PYG("250000000"), { at: "14:20" }),
    ]);
    expect(truth).toMatchObject({ value: PYG("250000000"), pending: null });
    expect(labels(truth)).toEqual({
      [d2]: "corroboration",
      [d1]: "corroboration",
      [h1]: "current",
    });
  });

  it("la detección más reciente decide el pendiente; una anterior distinta queda reemplazada", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      detection(d1, "budget_max", PYG("270000000"), { at: "14:10" }),
      detection(d2, "budget_max", PYG("250000000"), { at: "14:20" }),
    ]);
    expect(truth.pending).toBeNull();
    expect(labels(truth)).toMatchObject({
      [d2]: "corroboration",
      [d1]: "superseded",
    });
  });

  it("una detección anterior al último acto humano queda cubierta", () => {
    const truth = resolveFact("purchase_type", [
      detection(d1, "purchase_type", "financed", { at: "13:00" }),
      human(h1, "purchase_type", "confirmed", "cash", { at: "14:05" }),
    ]);
    expect(truth).toMatchObject({ value: "cash", pending: null });
    expect(labels(truth)).toEqual({ [h1]: "current", [d1]: "covered" });
  });

  it("T18: aceptar el pendiente → Confirmado con su valor; la evidencia es la de la detección", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("250000000"), { at: "14:05" }),
      detection(d1, "budget_max", PYG("270000000"), {
        at: "14:10",
        note: "puedo llegar a 270",
      }),
      human(h2, "budget_max", "confirmed", PYG("270000000"), {
        target: d1,
        previous: h1,
        at: "14:15",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: PYG("270000000"),
      factId: h2,
      headId: h2,
      pending: null,
      evidenceText: "puedo llegar a 270",
    });
    expect(labels(truth)).toEqual({
      [h2]: "current",
      [d1]: "superseded",
      [h1]: "superseded",
    });
  });

  it("T20: reemplazar la detección vigente por error de carga → Corregido; la detección queda Errónea", () => {
    const truth = resolveFact("budget_max", [
      detection(d1, "budget_max", PYG("2500000000"), { at: "14:00" }),
      human(h1, "budget_max", "corrected", PYG("250000000"), {
        target: d1,
        at: "14:05",
      }),
    ]);
    expect(truth).toMatchObject({
      status: "corrected",
      value: PYG("250000000"),
      replaced: PYG("2500000000"),
    });
    expect(labels(truth)).toEqual({ [h1]: "current", [d1]: "erroneous" });
  });

  it("T13: «quiero uno como este» lo tipea el vendedor: un Confirmado con nota, nada inferido", () => {
    const truth = resolveFact("desired_vehicle", [
      human(
        h1,
        "desired_vehicle",
        "confirmed",
        { model: "Hilux" },
        {
          note: "Mandó la foto de una Hilux blanca",
        },
      ),
    ]);
    expect(truth).toMatchObject({
      status: "confirmed",
      value: { model: "Hilux" },
      evidenceText: "Mandó la foto de una Hilux blanca",
    });
  });

  it("T14: preferencia incompleta {brand: Toyota}", () => {
    expect(
      resolveFact("desired_vehicle", [
        human(h1, "desired_vehicle", "confirmed", { brand: "Toyota" }),
      ]),
    ).toMatchObject({ status: "confirmed", value: { brand: "Toyota" } });
  });

  it("T26: entrega 0 es un valor, no Unknown", () => {
    expect(
      resolveFact("down_payment", [
        human(h1, "down_payment", "confirmed", PYG("0")),
      ]),
    ).toMatchObject({ status: "confirmed", value: PYG("0") });
  });
});

describe("CT3 / HP1: ninguna combinación de detecciones cambia un valor humano", () => {
  const ledgers = {
    confirmado: [
      human(h1, "purchase_type", "confirmed", "cash", { at: "14:05" }),
    ],
    corregido: [
      human(h1, "purchase_type", "confirmed", "financed", { at: "14:05" }),
      human(h2, "purchase_type", "corrected", "cash", {
        target: h1,
        previous: h1,
        at: "14:06",
      }),
    ],
    quitado: [
      human(h1, "purchase_type", "confirmed", "cash", { at: "14:05" }),
      human(h2, "purchase_type", "rejected", null, {
        target: h1,
        previous: h1,
        at: "14:06",
      }),
    ],
  };
  const machineSets = [
    [],
    [detection(d1, "purchase_type", "financed", { at: "14:00" })],
    [detection(d1, "purchase_type", "financed", { at: "14:30" })],
    [detection(d1, "purchase_type", "cash", { at: "14:30" })],
    [
      detection(d1, "purchase_type", "financed", { at: "13:00" }),
      detection(d2, "purchase_type", "undecided", { at: "15:00" }),
      detection(d3, "purchase_type", "cash", {
        observed: "16:00",
        at: "16:00",
      }),
    ],
  ];

  it.each(Object.entries(ledgers))("%s", (_, ledger) => {
    const base = resolveFact("purchase_type", ledger);
    for (const machine of machineSets) {
      const truth = resolveFact("purchase_type", [...ledger, ...machine]);
      expect(truth.status).toBe(base.status);
      expect(truth.value).toEqual(base.value);
      expect(truth.factId).toBe(base.factId);
      expect(truth.status).not.toBe("detected");
    }
  });
});

describe("T22: cadena inconsistente → Unknown inconsistent (fail-closed)", () => {
  it.each([
    [
      "dos roots",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h2, "budget_max", "confirmed", PYG("2"), { at: "14:10" }),
      ],
    ],
    [
      "dos sucesores del mismo acto",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h2, "budget_max", "confirmed", PYG("2"), {
          target: h1,
          previous: h1,
        }),
        human(h3, "budget_max", "confirmed", PYG("3"), {
          target: h1,
          previous: h1,
        }),
      ],
    ],
    [
      "previous hacia una fila que no está",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h2, "budget_max", "confirmed", PYG("2"), {
          target: h1,
          previous: h3,
        }),
      ],
    ],
    [
      "rechazo de un valor humano que ya no es el ancla",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h2, "budget_max", "confirmed", PYG("2"), {
          target: h1,
          previous: h1,
        }),
        human(h3, "budget_max", "rejected", null, {
          target: h1,
          previous: h2,
        }),
      ],
    ],
    [
      "un valor sobre otro sin apuntarlo",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h2, "budget_max", "confirmed", PYG("2"), { previous: h1 }),
      ],
    ],
    [
      "actuar sobre una detección ya resuelta",
      [
        detection(d1, "budget_max", PYG("1")),
        human(h1, "budget_max", "rejected", null, { target: d1 }),
        human(h2, "budget_max", "confirmed", PYG("1"), {
          target: d1,
          previous: h1,
        }),
      ],
    ],
    [
      "una fila humana marcada como detectada",
      [
        {
          ...human(h1, "budget_max", "confirmed", PYG("1")),
          status: "detected",
        },
      ],
    ],
    [
      "un rechazo con valor",
      [human(h1, "budget_max", "rejected", PYG("1"), { target: h1 })],
    ],
    [
      "ids repetidos",
      [
        human(h1, "budget_max", "confirmed", PYG("1")),
        human(h1, "budget_max", "confirmed", PYG("1")),
      ],
    ],
  ] as [string, DemandRow[]][])("%s", (_, ledger) => {
    expect(resolveFact("budget_max", ledger as never)).toMatchObject({
      status: "unknown",
      value: null,
      unknownReason: "inconsistent",
      pending: null,
      history: [],
    });
  });
});

describe("historial", () => {
  it("cada fila con su etiqueta, en orden recordedAt desc, posición en la cadena, id desc", () => {
    const truth = resolveFact("budget_max", [
      human(h1, "budget_max", "confirmed", PYG("1"), { at: "14:00" }),
      human(h2, "budget_max", "confirmed", PYG("2"), {
        target: h1,
        previous: h1,
        at: "14:00",
      }),
      detection(d1, "budget_max", PYG("3"), { at: "15:00" }),
      detection(d2, "budget_max", PYG("4"), { at: "13:00" }),
    ]);
    expect(truth.history.map((e) => [e.factId, e.label])).toEqual([
      [d1, "pending"],
      [h2, "current"],
      [h1, "superseded"],
      [d2, "covered"],
    ]);
    expect(truth.history[1]).toEqual({
      factId: h2,
      status: "confirmed",
      sourceKind: "member",
      recordedBy: SELLER,
      recordedAt: at("14:00"),
      value: PYG("2"),
      evidenceText: null,
      targetFactId: h1,
      label: "current",
    });
  });
});

describe("CT2: determinista", () => {
  const ledger: DemandRow[] = [
    detection(d1, "budget_max", PYG("220000000"), { at: "13:00" }),
    human(h1, "budget_max", "confirmed", PYG("230000000"), {
      target: d1,
      at: "14:00",
    }),
    human(h2, "budget_max", "confirmed", PYG("240000000"), {
      target: h1,
      previous: h1,
      at: "14:30",
    }),
    detection(d2, "budget_max", PYG("250000000"), { at: "15:00" }),
    detection(d3, "budget_max", PYG("260000000"), { at: "15:00" }),
    human(id("h4"), "purchase_type", "confirmed", "cash"),
    detection(id("d4"), "year_range", { min: 2020 }),
  ];

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
        (rest) => [item, ...rest],
      ),
    );
  }

  it("la misma entrada en cualquier orden da la misma salida", () => {
    const expected = resolveDemand(ledger);
    for (const order of permutations(ledger)) {
      expect(resolveDemand(order)).toEqual(expected);
    }
    expect(expected.budget_max).toMatchObject({
      value: PYG("240000000"),
      pending: { factId: d3 },
    });
    expect(expected.purchase_type.value).toBe("cash");
    expect(expected.year_range).toMatchObject({
      status: "detected",
      value: { min: 2020 },
    });
  });
});

describe("F2: la fila del contrato tiene observedAt (null en H1.4)", () => {
  it("una fila humana de H1.4 no tiene observedAt", () => {
    expect(human(h1, "budget_max", "confirmed", PYG("1")).observedAt).toBe(
      null,
    );
  });
});
