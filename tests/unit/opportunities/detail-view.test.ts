import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MessageForm } from "@/components/conversations/message-form";
import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail";
import type { ActivityEntry } from "@/domains/conversations/timeline";
import { demandDetail, demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import type { ClosureSummary } from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";
import type { LinkedVehicleCard } from "@/domains/opportunities/vehicle-link";

/*
 * /opportunities/[id] con el muro de actividad (Hito 4, DEC-036 §11) y la
 * unidad vinculada (Hito 2, DEC-033 §8), renderizada en el servidor sin DOM:
 * - el panel "Actividad" con el selector Nota / Mensaje, sus formularios y
 *   el muro de notas y mensajes, sin ids de usuario;
 * - las tarjetas de match ofrecen "Vincular a la negociación" solo En
 *   negociación (DEC-034 §4: en Ganada la unidad queda fija), y la vinculada
 *   se marca en vez de ofrecerse;
 * - la tarjeta de la unidad vinculada ofrece quitarla solo En negociación;
 * - una oportunidad cerrada muestra la tarjeta "Cierre" (DEC-034 §11).
 * Las Server Actions no se llaman: se prueban en note-action.test.ts,
 * message-action.test.ts, vehicle-link-action.test.ts y contra la base en
 * tests/db/.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  addOpportunityNote: vi.fn(),
  linkOpportunityVehicle: vi.fn(),
  changeOpportunityStage: vi.fn(),
  closeOpportunity: vi.fn(),
  recordDemand: vi.fn(),
  createOpportunity: vi.fn(),
}));
vi.mock("@/lib/conversations/actions", () => ({ addMessage: vi.fn() }));

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

const ACTIVITY: readonly ActivityEntry[] = [
  {
    kind: "message",
    id: "50000000-0000-4000-8000-000000000001",
    label: "Mensaje recibido",
    channel: "whatsapp",
    channelLabel: "WhatsApp",
    direction: "inbound",
    body: "¿Sigue disponible?",
    author: "Vos",
    at: "11 oct 2026 18:40",
  },
  {
    kind: "note",
    id: "40000000-0000-4000-8000-000000000002",
    label: "Nota",
    body: "Pidió cuota fija.\nVuelve el lunes.",
    author: "Otro miembro",
    at: "11 oct 2026 14:32",
  },
  {
    kind: "note",
    id: "40000000-0000-4000-8000-000000000001",
    label: "Nota",
    body: "Primera llamada.",
    author: "Vos",
    at: "11 oct 2026 09:00",
  },
];

function render({
  stage = "negotiating",
  linked = null,
  canChange = stage === "negotiating",
  activity = ACTIVITY,
  matches = MATCHES,
  closure = null,
}: {
  stage?: Stage;
  linked?: LinkedVehicleCard | null;
  canChange?: boolean;
  activity?: readonly ActivityEntry[];
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
      activity,
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

describe("panel Actividad", () => {
  it("selector Nota / Mensaje, el formulario de notas por defecto y el muro en el orden recibido", () => {
    const html = render();
    expect(html).toContain('id="activity-heading"');
    expect(html).toContain("3 registros");
    const selector = html.slice(
      html.indexOf('aria-label="Qué registrás"'),
      html.indexOf("</div>", html.indexOf('aria-label="Qué registrás"')),
    );
    expect(selector).toMatch(/aria-pressed="true"[^>]*>Nota</);
    expect(selector).toMatch(/aria-pressed="false"[^>]*>Mensaje</);
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    expect(html).toContain(`name="opportunityId" value="${ID}"`);
    expect(html).toContain("Agregar nota");
    expect(html).toContain("0 / 1.000");
    const wall = html.slice(
      html.indexOf('aria-label="Muro de actividad de la oportunidad"'),
    );
    const positions = [
      "Mensaje recibido",
      "Otro miembro · 11 oct 2026 14:32",
      "Vos · 11 oct 2026 09:00",
    ].map((text) => wall.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    // El mensaje muestra su canal.
    expect(wall).toContain("WhatsApp");
    // Los saltos de línea se respetan.
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("Pidió cuota fija.\nVuelve el lunes.");
  });

  it("sin actividad: un estado vacío que invita a registrar", () => {
    const html = render({ activity: [] });
    expect(html).toContain("0 registros");
    expect(html).toContain("Todavía no hay actividad.");
    expect(html).not.toContain("Muro de actividad de la oportunidad");
  });

  it.each(["new", "qualifying", "won", "lost"] as const)(
    "en %s también se puede registrar",
    (stage) => {
      const html = render({ stage });
      expect(html).toContain("Agregar nota");
      expect(html).toContain('aria-label="Qué registrás"');
    },
  );

  it("ningún id de usuario llega al HTML", () => {
    const html = render();
    expect(html).not.toMatch(/00000000-0000-4000-8000-00000000000[ac]/);
  });
});

describe("formulario de mensajes", () => {
  function renderForm(): string {
    return renderToStaticMarkup(
      createElement(MessageForm, { opportunityId: ID }),
    );
  }

  it("envía la oportunidad, el canal (WhatsApp por defecto), la dirección a elegir y el texto", () => {
    const html = renderForm();
    expect(html).toContain(`name="opportunityId" value="${ID}"`);
    const channel = html.slice(
      html.indexOf('name="channel"'),
      html.indexOf("</select>", html.indexOf('name="channel"')),
    );
    expect(channel).toMatch(/<option value="whatsapp" selected="">WhatsApp</);
    expect(channel).toContain('<option value="email">Email</option>');
    expect(channel).toContain('<option value="manual">Otro medio</option>');
    const direction = html.slice(
      html.indexOf('name="direction"'),
      html.indexOf("</select>", html.indexOf('name="direction"')),
    );
    expect(direction).toMatch(
      /<option value="" disabled="" selected="">Elegí</,
    );
    expect(direction).toContain(
      '<option value="inbound">Recibido del cliente</option>',
    );
    expect(direction).toContain(
      '<option value="outbound">Enviado al cliente</option>',
    );
    expect(html).toMatch(/<textarea[^>]*name="content"/);
    expect(html).toContain("0 / 4.096");
    expect(html).toContain("Registrar mensaje");
  });

  it("aclara que registrar no envía nada al cliente", () => {
    expect(renderForm()).toContain(
      "Registrar no envía nada al cliente: deja constancia de lo que ya pasó.",
    );
  });
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
