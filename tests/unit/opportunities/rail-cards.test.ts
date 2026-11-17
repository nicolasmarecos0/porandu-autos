import { existsSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WhyNowCard } from "@/components/intelligence/why-now";
import { DemandCard } from "@/components/opportunities/demand-card";
import { Avatar } from "@/components/ui/avatar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StockMatchCards } from "@/components/vehicle-rail/vehicle-rail";
import { VehicleRender } from "@/components/vehicle-rail/vehicle-render";
import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import { PROSPECT_AVATARS } from "@/domains/opportunities/prospect";
import type { Driver } from "@/domains/scoring/types";

import { human } from "../support/demand-rows";

/*
 * Rail derecho y "¿Por qué ahora?" de /opportunities (DEC-058), renderizados
 * en el servidor sin DOM:
 * - Top Match (borde naranja), Alternativa (borde azul acero sutil), su
 *   estado (0 km o Usado), la diferencia contra el presupuesto y el render
 *   genérico de la carrocería, siempre con "Representación";
 * - la tarjeta "Busca" con sus píldoras, "Editar" con borde de marca y el
 *   render del vehículo buscado;
 * - las señales fuertes y a validar, con las cifras en negrita;
 * - el avatar ilustrado con las iniciales como respaldo.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  recordOpportunityDemand: vi.fn(),
}));

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

function card(overrides: Partial<MatchCard> = {}): MatchCard {
  return {
    vehicleId: "20000000-0000-4000-8000-000000000001",
    name: "Toyota Hilux",
    detail: "SRV 2.8 4x4 AT · 2025",
    price: "USD 49.900",
    km: "0 km",
    score: { total: 100, vehicle: 45, year: 25, budget: 30 },
    reasons: ["Marca y modelo coinciden exactamente"],
    condition: "new",
    body: "pickup",
    budgetDelta: { kind: "under", amount: "USD 8.100" },
    balance: {
      label: "Saldo sin usado",
      downPayment: "USD 20.000",
      amount: "USD 29.900",
    },
    ...overrides,
  };
}

/** El primer elemento con ese aria-label, entero. */
function section(markup: string, label: string): string {
  const start = markup.indexOf(`aria-label="${label}"`);
  if (start === -1) throw new Error(`missing ${label}`);
  const end = markup.indexOf("</section>", start);
  return markup.slice(markup.lastIndexOf("<", start), end);
}

describe("StockMatchCards", () => {
  const rail: MatchRail = {
    kind: "matches",
    top: card(),
    alternative: card({
      vehicleId: "20000000-0000-4000-8000-000000000002",
      detail: "SR 2.4 4x2 · 2025",
      price: "USD 42.500",
      km: "18.000 km",
      condition: "used",
      budgetDelta: { kind: "over", amount: "USD 1.500" },
    }),
  };

  it("Top Match: borde naranja, 0 km, precio contra presupuesto y saldo", () => {
    const top = section(
      render(createElement(StockMatchCards, { rail })),
      "Top Match",
    );
    expect(top).toContain("border-2 border-accent");
    expect(top).toContain(">0 km<");
    expect(top).toContain("USD 49.900");
    expect(top).toMatch(/text-success[^>]*>USD 8\.100 debajo</);
    expect(top).toContain("Saldo sin usado");
    expect(top).toContain("USD 29.900");
    expect(top).toContain('src="/vehicles/pickup.svg"');
    expect(top).toContain("Representación");
    expect(top).toContain("Marca y modelo coinciden exactamente");
  });

  it("Alternativa: borde azul acero sutil, Usado y el exceso en rojo", () => {
    const alternative = section(
      render(createElement(StockMatchCards, { rail })),
      "Alternativa",
    );
    expect(alternative).toContain("border-2 border-brand/40");
    expect(alternative).toContain(">Usado<");
    expect(alternative).toMatch(/text-danger[^>]*>USD 1\.500 arriba</);
    expect(alternative).toContain('src="/vehicles/pickup.svg"');
    expect(alternative).toContain("Representación");
  });

  it("sin carrocería conocida, sin render; sin presupuesto, sin fila", () => {
    const html = render(
      createElement(StockMatchCards, {
        rail: {
          kind: "matches",
          top: card({ body: null, budgetDelta: null, balance: null }),
          alternative: null,
        },
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Representación");
    expect(html).not.toContain("Presupuesto");
    expect(html).not.toContain('aria-label="Alternativa"');
  });

  it("rail vacío: dice por qué, sin tarjetas inventadas", () => {
    const html = render(
      createElement(StockMatchCards, {
        rail: { kind: "empty", reason: "no_match" },
      }),
    );
    expect(html).toContain(
      "Ninguna unidad disponible alcanza 40 de 100 puntos de match.",
    );
    expect(html).not.toContain('aria-label="Top Match"');
  });
});

describe("VehicleRender", () => {
  it("ilustración local con texto alternativo y la etiqueta Representación", () => {
    const html = renderToStaticMarkup(
      createElement(VehicleRender, { body: "suv" }),
    );
    expect(html).toContain('src="/vehicles/suv.svg"');
    expect(html).toContain('alt="Representación genérica de un SUV"');
    expect(html).toContain("<figcaption");
    expect(html).toContain("Representación</figcaption>");
  });

  it("sin carrocería no muestra nada", () => {
    expect(
      renderToStaticMarkup(createElement(VehicleRender, { body: null })),
    ).toBe("");
  });
});

describe("DemandCard", () => {
  const demand = demandSummary(
    resolveDemand([
      human("v", "desired_vehicle", "confirmed", {
        brand: "Toyota",
        model: "Hilux",
      }),
      human("p", "purchase_type", "confirmed", "financed"),
      human("t", "trade_in_intent", "confirmed", true),
    ]),
  );

  it("píldoras de trade-in y pago, Editar con borde de marca y el render", () => {
    const html = render(
      createElement(DemandCard, {
        opportunityId: "10000000-0000-4000-8000-000000000001",
        demand,
      }),
    );
    expect(html).toContain(">Con trade-in<");
    expect(html).toContain(">Financiado<");
    expect(html).toMatch(/<button[^>]*border-brand[^>]*>Editar<\/button>/);
    expect(html).toContain('src="/vehicles/pickup.svg"');
    expect(html).toContain("Representación");
  });

  it("sin vehículo cargado no hay render", () => {
    const html = render(
      createElement(DemandCard, {
        opportunityId: "10000000-0000-4000-8000-000000000001",
        demand: demandSummary(resolveDemand([])),
      }),
    );
    expect(html).toContain("Vehículo sin definir");
    expect(html).not.toContain("<img");
  });
});

describe("WhyNowCard", () => {
  const drivers: Driver[] = [
    {
      kind: "downPayment",
      label: "Entrega inicial",
      detail: "Entrega USD 20.000: el 34 % del presupuesto de USD 58.000.",
      source: "Lo que busca",
      strength: 90,
      emphasis: ["USD 20.000", "34 %", "USD 58.000"],
    },
    {
      kind: "financing",
      label: "Financiación",
      detail: "Compra financiada: validar las condiciones del crédito.",
      source: "Lo que busca",
      strength: 70,
    },
  ];

  it("fuertes y a validar, con las cifras reales en negrita y su peso", () => {
    const html = render(
      createElement(WhyNowCard, { drivers, showSources: true, footer: null }),
    );
    expect(html).toMatch(
      /Señales fuertes.*Entrega inicial.*A validar.*Financiación/,
    );
    expect(html).toContain(
      'Entrega <strong class="font-semibold text-text-primary">USD 20.000</strong>: el <strong class="font-semibold text-text-primary">34 %</strong> del presupuesto de <strong class="font-semibold text-text-primary">USD 58.000</strong>.',
    );
    expect(html).toContain('<span class="sr-only">Peso </span>90');
    expect(html).toContain(">Entrega<");
    expect(html).toContain(">Pago<");
    // Sin momento, la fuente va sola.
    expect(html).toContain(">Lo que busca<");
  });

  it("sin señales lo dice", () => {
    const html = render(
      createElement(WhyNowCard, {
        drivers: [],
        showSources: true,
        footer: null,
      }),
    );
    expect(html).toContain("Sin señales registradas todavía.");
  });
});

describe("Avatar ilustrado", () => {
  it("la ilustración va sobre las iniciales, que quedan de respaldo", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, {
        initials: "MB",
        src: "/avatars/prospect-01.svg",
        size: "2xl",
      }),
    );
    expect(html).toContain("MB");
    expect(html).toContain('src="/avatars/prospect-01.svg"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("sin imagen, solo las iniciales", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, { initials: "MB" }),
    );
    expect(html).toContain("MB");
    expect(html).not.toContain("<img");
  });
});

describe("assets locales (sin URLs externas)", () => {
  const PUBLIC = join(process.cwd(), "public");

  it.each(PROSPECT_AVATARS.map((path) => [path]))("%s existe", (path) => {
    expect(existsSync(join(PUBLIC, path))).toBe(true);
  });

  it.each(["pickup", "suv", "sedan", "hatch"])(
    "/vehicles/%s.svg existe",
    (body) => {
      expect(existsSync(join(PUBLIC, "vehicles", `${body}.svg`))).toBe(true);
    },
  );
});
