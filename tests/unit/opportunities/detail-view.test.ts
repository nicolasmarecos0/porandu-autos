import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail";
import { demandDetail, demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import type { ClosureSummary } from "@/domains/opportunities/closure";
import type { NoteEntry } from "@/domains/opportunities/notes";
import type { Stage } from "@/domains/opportunities/stages";
import type { LinkedVehicleCard } from "@/domains/opportunities/vehicle-link";

/*
 * /opportunities/[id] con la bitácora y la unidad vinculada (Hito 2, DEC-033
 * §8), renderizada en el servidor sin DOM:
 * - el panel "Notas" con su formulario y la bitácora, sin ids de usuario;
 * - las tarjetas de match ofrecen "Vincular a la negociación" solo En
 *   negociación (DEC-034 §4: en Ganada la unidad queda fija), y la vinculada
 *   se marca en vez de ofrecerse;
 * - la tarjeta de la unidad vinculada ofrece quitarla solo En negociación;
 * - una oportunidad cerrada muestra la tarjeta "Cierre" (DEC-034 §11).
 * Las Server Actions no se llaman: se prueban en note-action.test.ts,
 * vehicle-link-action.test.ts y contra la base en tests/db/.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  addOpportunityNote: vi.fn(),
  linkOpportunityVehicle: vi.fn(),
  changeOpportunityStage: vi.fn(),
  closeOpportunity: vi.fn(),
  recordDemand: vi.fn(),
  createOpportunity: vi.fn(),
}));

const ID = "10000000-0000-4000-8000-000000000101";
const TOP = "20000000-0000-4000-8000-000000000101";
const ALT = "20000000-0000-4000-8000-000000000102";

function card(vehicleId: string, name: string, total: number): MatchCard {
  return {
    vehicleId,
    name,
    detail: "2025",
    price: "USD 49.900",
    km: "0 km",
    score: { total, vehicle: 45, year: 25, budget: total - 70 },
    reasons: ["Marca y modelo coinciden exactamente"],
  };
}

const MATCHES: MatchRail = {
  kind: "matches",
  top: card(TOP, "Toyota Hilux", 100),
  alternative: card(ALT, "Toyota SW4", 70),
};

const LINKED: LinkedVehicleCard = {
  vehicleId: TOP,
  name: "Toyota Hilux",
  detail: "SRV 2.8 4x4 AT · 2025",
  price: "USD 49.900",
  km: "0 km",
  status: "available",
  statusLabel: "Disponible",
};

const NOTES: readonly NoteEntry[] = [
  {
    id: "40000000-0000-4000-8000-000000000002",
    body: "Pidió cuota fija.\nVuelve el lunes.",
    author: "Otro miembro",
    at: "11 oct 2026 14:32",
  },
  {
    id: "40000000-0000-4000-8000-000000000001",
    body: "Primera llamada.",
    author: "Vos",
    at: "11 oct 2026 09:00",
  },
];

function render({
  stage = "negotiating",
  linked = null,
  canChange = stage === "negotiating",
  notes = NOTES,
  matches = MATCHES,
  closure = null,
}: {
  stage?: Stage;
  linked?: LinkedVehicleCard | null;
  canChange?: boolean;
  notes?: readonly NoteEntry[];
  matches?: MatchRail;
  closure?: ClosureSummary | null;
} = {}): string {
  const truth = resolveDemand([]);
  return renderToStaticMarkup(
    createElement(OpportunityDetailView, {
      id: ID,
      contactName: "Ana Benítez",
      stage,
      closure,
      demand: demandDetail(truth, {
        viewerUserId: "u",
        createdAt: new Date("2026-10-06T14:05:00Z"),
      }),
      summary: demandSummary(truth, {}),
      matches,
      vehicleLink: { canChange, linked },
      notes,
    }),
  );
}

/** El HTML de una sección por su aria-label. */
function section(html: string, label: string): string {
  const start = html.indexOf(`aria-label="${label}"`);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );
}

describe("panel Notas", () => {
  it("formulario con la oportunidad y el texto, y la bitácora en el orden recibido", () => {
    const html = render();
    expect(html).toContain('id="notes-heading"');
    expect(html).toContain("2 notas");
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    expect(html).toContain(`name="opportunityId" value="${ID}"`);
    expect(html).toContain("Agregar nota");
    expect(html).toContain("0 / 1.000");
    const timeline = html.slice(
      html.indexOf('aria-label="Bitácora de la oportunidad"'),
    );
    expect(timeline.indexOf("Otro miembro · 11 oct 2026 14:32")).toBeLessThan(
      timeline.indexOf("Vos · 11 oct 2026 09:00"),
    );
    // Los saltos de línea de la nota se respetan.
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("Pidió cuota fija.\nVuelve el lunes.");
  });

  it("sin notas: un estado vacío que invita a registrar", () => {
    const html = render({ notes: [] });
    expect(html).toContain("0 notas");
    expect(html).toContain("Todavía no hay notas.");
    expect(html).not.toContain("Bitácora de la oportunidad");
  });

  it.each(["new", "qualifying", "won", "lost"] as const)(
    "en %s también se puede anotar",
    (stage) => {
      expect(render({ stage })).toContain("Agregar nota");
    },
  );
});

describe("unidad vinculada desde las tarjetas de match", () => {
  it.each(["negotiating"] as const)(
    "en %s sin unidad: las dos tarjetas ofrecen vincularse con su id",
    (stage) => {
      const html = render({ stage });
      for (const [label, vehicleId, name] of [
        ["Top Match", TOP, "Toyota Hilux"],
        ["Alternativa", ALT, "Toyota SW4"],
      ] as const) {
        const cardHtml = section(html, label);
        expect(buttons(cardHtml)).toEqual([
          `Vincular a la negociación: ${name}`,
        ]);
        expect(cardHtml).toContain(`name="vehicleId" value="${vehicleId}"`);
      }
      expect(html).toContain("Todavía no hay una unidad vinculada.");
      expect(html).not.toContain("Quitar vínculo");
    },
  );

  it("la tarjeta de la unidad vinculada se marca y la otra se ofrece; arriba se puede quitar", () => {
    const html = render({ linked: LINKED });
    const top = section(html, "Top Match");
    expect(top).toContain("Vinculada a la negociación");
    expect(buttons(top)).toEqual([]);
    expect(buttons(section(html, "Alternativa"))).toEqual([
      "Vincular a la negociación: Toyota SW4",
    ]);
    const linked = section(html, "Unidad en negociación");
    expect(linked).toContain("Toyota Hilux");
    expect(linked).toContain("Vincularla no la reserva: el stock no cambia.");
    expect(buttons(linked)).toEqual(["Quitar vínculo: Toyota Hilux"]);
    // Quitar envía la unidad vacía.
    expect(linked).toContain('name="vehicleId" value=""');
  });

  it("Ganada: la unidad de la venta, de solo lectura y sin marcarla vendida (DEC-034 §4)", () => {
    const html = render({ stage: "won", linked: LINKED });
    const linked = section(html, "Unidad de la venta");
    expect(linked).toContain("el stock no cambia");
    expect(buttons(linked)).toEqual([]);
    expect(html).not.toContain("Vincular a la negociación:");
    expect(html).not.toContain("Quitar vínculo");
    expect(section(html, "Top Match")).toContain("Vinculada a la negociación");
  });

  it.each(["new", "qualifying"] as const)(
    "en %s no se ofrece vincular, y se avisa desde cuándo",
    (stage) => {
      const html = render({ stage });
      expect(html).not.toContain("Vincular a la negociación");
      expect(html).toContain(
        "Vas a poder vincular una de estas unidades cuando la oportunidad esté En negociación.",
      );
      expect(html).not.toContain("Todavía no hay una unidad vinculada.");
    },
  );

  it("Perdida: la unidad que se negociaba, de solo lectura", () => {
    const html = render({ stage: "lost", linked: LINKED });
    const linked = section(html, "Unidad que se negociaba");
    expect(linked).toContain("Toyota Hilux");
    expect(buttons(linked)).toEqual([]);
    expect(html).not.toContain("Vincular a la negociación:");
    expect(html).not.toContain("Quitar vínculo");
    expect(section(html, "Top Match")).toContain("Vinculada a la negociación");
  });

  it("una unidad vinculada que ya no está disponible muestra su estado", () => {
    const html = render({
      linked: { ...LINKED, status: "reserved", statusLabel: "Reservado" },
    });
    expect(section(html, "Unidad en negociación")).toContain("Reservado");
  });

  it("sin matches, la unidad vinculada se sigue mostrando", () => {
    const html = render({
      linked: { ...LINKED, vehicleId: ALT },
      matches: { kind: "empty", reason: "no_match" },
    });
    expect(section(html, "Unidad en negociación")).toContain("Toyota Hilux");
    expect(html).toContain("Ninguna unidad disponible alcanza 40");
  });
});

describe("tarjeta Cierre (DEC-034 §11)", () => {
  const WON: ClosureSummary = {
    outcome: "won",
    salePrice: "USD 47.500",
    paymentMethod: "Financiación",
    delivery: "Programada para el 15 oct 2026",
  };
  const LOST: ClosureSummary = {
    outcome: "lost",
    reason: "Compró en la competencia",
    notes: "Le dieron mejor tasación.\nVolver a contactar en marzo.",
  };

  /** El HTML de la tarjeta Cierre. */
  function closureCard(html: string): string {
    const start = html.indexOf('aria-labelledby="closure-heading"');
    if (start === -1) return "";
    return html.slice(start, html.indexOf("</section>", start));
  }

  it.each(["new", "qualifying", "negotiating"] as const)(
    "en %s no hay cierre que mostrar",
    (stage) => {
      expect(closureCard(render({ stage }))).toBe("");
    },
  );

  it("Ganada: precio final, forma de pago, entrega y la unidad vendida, sin acciones", () => {
    const html = render({ stage: "won", linked: LINKED, closure: WON });
    const card = closureCard(html);
    expect(card).toContain(">Cierre<");
    expect(card).toContain("Ganada");
    for (const text of [
      "Precio final",
      "USD 47.500",
      "Forma de pago",
      "Financiación",
      "Entrega",
      "Programada para el 15 oct 2026",
      "Unidad",
      "Toyota Hilux",
      "el stock no cambia",
      "Los datos del cierre no se pueden modificar.",
    ]) {
      expect(card).toContain(text);
    }
    expect(buttons(card)).toEqual([]);
    // Sigue después del panel de etapa.
    expect(html.indexOf('id="closure-heading"')).toBeGreaterThan(
      html.indexOf('id="stage-heading"'),
    );
  });

  it("Perdida: motivo y notas con sus saltos de línea", () => {
    const card = closureCard(render({ stage: "lost", closure: LOST }));
    expect(card).toContain("Perdida");
    expect(card).toContain("Motivo");
    expect(card).toContain("Compró en la competencia");
    expect(card).toContain("whitespace-pre-line");
    expect(card).toContain(
      "Le dieron mejor tasación.\nVolver a contactar en marzo.",
    );
    expect(card).not.toContain("Precio final");
  });

  it("Perdida sin notas lo dice", () => {
    const card = closureCard(
      render({ stage: "lost", closure: { ...LOST, notes: null } }),
    );
    expect(card).toContain("Sin notas");
  });
});
