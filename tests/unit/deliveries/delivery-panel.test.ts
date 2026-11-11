import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DeliveryPanel } from "@/components/deliveries/delivery-panel";
import {
  EMPTY_DELIVERY_CHECKLIST,
  VERIFIED_DELIVERY_CHECKLIST,
  withChecklistItem,
} from "@/domains/opportunities/deliveries";
import {
  deliveryPanelData,
  optimisticDeliveryPanel,
  progressLabel,
  suggestedDeliveryInput,
  type DeliveryPanelContext,
  type DeliveryRow,
} from "@/domains/opportunities/delivery-presentation";
import type { Stage } from "@/domains/opportunities/stages";
import type { VehicleStatus } from "@/domains/vehicles/stock";

/*
 * Panel "Coordinación de Entrega" (Hito 21, DEC-053) y su presentación
 * pura, renderizados en el servidor sin DOM: solo con la oportunidad
 * Ganada, el alta con la fecha sugerida, el checklist con casillas de Radix
 * y su progreso, el botón de completar habilitado solo con todo verificado,
 * el estado optimista y la entrega completada. Las Server Actions no se
 * llaman: se prueban contra la base en tests/db/deliveries.test.ts.
 */

vi.mock("@/lib/deliveries/actions", () => ({
  scheduleDelivery: vi.fn(),
  rescheduleDelivery: vi.fn(),
  setDeliveryChecklistItem: vi.fn(),
  completeDelivery: vi.fn(),
}));

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000c";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";
const NOW = new Date("2026-11-11T13:00:00.000Z"); // 10:00 en Asunción.

function context(
  overrides: Partial<DeliveryPanelContext> & {
    unitStatus?: VehicleStatus;
  } = {},
): DeliveryPanelContext {
  const { unitStatus = "sold", ...rest } = overrides;
  return {
    viewerUserId: VIEWER,
    stage: "won",
    unit: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Toyota Hilux",
      detail: "SRV 2.8 4x4 AT · 2025",
      status: unitStatus,
    },
    closureDeliveryDate: null,
    now: NOW,
    ...rest,
  };
}

function row(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    status: "pending",
    scheduledAt: new Date("2026-11-13T13:30:00.000Z"),
    checklist: EMPTY_DELIVERY_CHECKLIST,
    createdBy: VIEWER,
    createdAt: new Date("2026-11-10T12:00:00.000Z"),
    completedBy: null,
    completedAt: null,
    ...overrides,
  };
}

function render(
  delivery: DeliveryRow | null,
  overrides: Parameters<typeof context>[0] = {},
  canCancel = true,
): string {
  return renderToStaticMarkup(
    createElement(DeliveryPanel, {
      opportunityId: OPPORTUNITY,
      data: deliveryPanelData(delivery, context(overrides)),
      canCancel,
    }),
  );
}

describe("anular una entrega según el rol (Hito 22, DEC-054 §4)", () => {
  it("un admin ve «Anular entrega» en una pendiente", () => {
    const html = render(row());
    expect(html).toMatch(/<button[^>]*>Anular entrega<\/button>/);
  });

  it("un seller la ve bloqueada, con quién la anula", () => {
    const html = render(row(), {}, false);
    expect(html).not.toMatch(/<button[^>]*>Anular entrega<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>/);
    expect(html).toContain(
      "Solo un administrador (gerente) anula una entrega.",
    );
  });

  it("una completada no se anula: no hay acción para ningún rol", () => {
    const completed = row({
      status: "completed",
      checklist: VERIFIED_DELIVERY_CHECKLIST,
      completedBy: VIEWER,
      completedAt: new Date("2026-11-13T14:00:00.000Z"),
    });
    for (const canCancel of [true, false]) {
      expect(render(completed, {}, canCancel)).not.toContain("Anular entrega");
    }
  });
});

describe("deliveryPanelData(): solo con la oportunidad Ganada", () => {
  it.each(["new", "qualifying", "negotiating", "lost"] as Stage[])(
    "con la oportunidad %s no hay panel",
    (stage) => {
      expect(deliveryPanelData(null, context({ stage }))).toEqual({
        kind: "hidden",
      });
      expect(render(null, { stage })).toBe("");
    },
  );

  it("ganada sin entrega: se programa con la fecha sugerida", () => {
    expect(deliveryPanelData(null, context())).toEqual({
      kind: "unscheduled",
      unit: {
        name: "Toyota Hilux",
        detail: "SRV 2.8 4x4 AT · 2025",
        status: "sold",
      },
      suggestedInput: "2026-11-12T10:00",
      minInput: "2026-11-11T10:00",
    });
  });

  it("ganada con la unidad que no está Vendida: bloqueada, con el porqué", () => {
    expect(
      deliveryPanelData(null, context({ unitStatus: "available" })),
    ).toMatchObject({ kind: "blocked" });
    expect(render(null, { unitStatus: "available" })).toContain(
      "la entrega se coordina con la unidad vendida",
    );
  });

  it("la fecha sugerida es la del cierre si todavía no pasó; si no, mañana a media mañana", () => {
    expect(suggestedDeliveryInput("2026-11-20", NOW)).toBe("2026-11-20T10:00");
    expect(suggestedDeliveryInput("2026-11-01", NOW)).toBe("2026-11-12T10:00");
    expect(suggestedDeliveryInput(null, NOW)).toBe("2026-11-12T10:00");
  });

  it("programada: la fecha en la hora de Asunción, el autor sin ids y el progreso", () => {
    const data = deliveryPanelData(
      row({
        checklist: withChecklistItem(EMPTY_DELIVERY_CHECKLIST, "keys", true),
        createdBy: OTHER,
      }),
      context(),
    );
    expect(data).toMatchObject({
      kind: "scheduled",
      delivery: {
        status: "pending",
        statusLabel: "Entrega programada",
        scheduledInput: "2026-11-13T10:30",
        overdue: false,
        progress: { done: 1, total: 5 },
        verified: false,
        scheduledByLabel: "Programó: Otro miembro",
        completedLabel: null,
      },
    });
    expect(JSON.stringify(data)).not.toContain(OTHER);
  });

  it("una pendiente con la fecha pasada se marca vencida", () => {
    expect(
      deliveryPanelData(
        row({ scheduledAt: new Date("2026-11-10T13:00:00.000Z") }),
        context(),
      ),
    ).toMatchObject({ delivery: { overdue: true } });
  });
});

describe("DeliveryPanel", () => {
  it("sin entrega: el formulario con la fecha pactada sugerida y su mínimo", () => {
    const html = render(null);
    expect(html).toContain("Coordinación de Entrega");
    expect(html).toContain("Programá la entrega de la unidad vendida");
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-11-12T10:00"');
    expect(html).toContain('min="2026-11-11T10:00"');
    expect(html).toContain("Programar entrega");
    expect(html).toContain(`value="${OPPORTUNITY}"`);
  });

  it("programada: cinco casillas de Radix con su etiqueta, y completar deshabilitado hasta verificar todo", () => {
    const html = render(
      row({
        checklist: withChecklistItem(EMPTY_DELIVERY_CHECKLIST, "keys", true),
      }),
    );
    expect(html.match(/role="checkbox"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    for (const label of [
      "Llaves",
      "Manuales",
      "Rueda de auxilio",
      "Limpieza",
      "Documentos",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("1 de 5 verificados");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Completar Entrega y Dar Salida al Vehículo<\/button>/,
    );
    expect(html).toContain(
      "Falta verificar manuales, rueda de auxilio, limpieza y documentos.",
    );
    expect(html).toContain("Reprogramar");
  });

  it("todo verificado: el botón se habilita y lo dice", () => {
    const html = render(row({ checklist: VERIFIED_DELIVERY_CHECKLIST }));
    expect(html).toContain("5 de 5 verificados");
    expect(html).toContain("Todo verificado: la unidad está lista para salir.");
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Completar Entrega y Dar Salida al Vehículo<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*>Completar Entrega y Dar Salida al Vehículo<\/button>/,
    );
  });

  it("completada: el sello, el checklist de solo lectura, la unidad Entregada y sin acciones", () => {
    const html = render(
      row({
        status: "completed",
        checklist: VERIFIED_DELIVERY_CHECKLIST,
        completedBy: VIEWER,
        completedAt: new Date("2026-11-13T13:42:00.000Z"),
      }),
      { unitStatus: "delivered" },
    );
    expect(html).toContain("Entrega completada");
    expect(html).toContain("Entregó: Vos");
    expect(html).toContain("Entregada");
    expect(html).toContain("ya no figura en el Inventario ni en el Catálogo");
    expect(html.match(/role="checkbox"[^>]*disabled=""/g)).toHaveLength(5);
    expect(html).not.toContain("Completar Entrega y Dar Salida al Vehículo");
    expect(html).not.toContain("Reprogramar");
  });
});

describe("optimisticDeliveryPanel(): el cambio se ve al instante", () => {
  const scheduled = {
    data: deliveryPanelData(row(), context()),
    saving: false,
  };

  it("tildar un ítem actualiza el checklist y el progreso", () => {
    const next = optimisticDeliveryPanel(scheduled, {
      kind: "check",
      item: "documents",
      checked: true,
    });
    expect(next.saving).toBe(true);
    expect(next.data).toMatchObject({
      kind: "scheduled",
      delivery: { checklist: { documents: true }, progress: { done: 1 } },
    });
    if (next.data.kind === "scheduled") {
      expect(progressLabel(next.data.delivery.progress)).toBe(
        "1 de 5 verificados",
      );
    }
  });

  it("completar pasa la entrega a Entregada y la unidad a delivered", () => {
    const verified = {
      data: deliveryPanelData(
        row({ checklist: VERIFIED_DELIVERY_CHECKLIST }),
        context(),
      ),
      saving: false,
    };
    expect(
      optimisticDeliveryPanel(verified, { kind: "complete" }),
    ).toMatchObject({
      saving: true,
      data: {
        unit: { status: "delivered" },
        delivery: { status: "completed", statusLabel: "Entregada" },
      },
    });
  });

  it("reprogramar muestra la nueva fecha pactada", () => {
    expect(
      optimisticDeliveryPanel(scheduled, {
        kind: "reschedule",
        scheduledInput: "2026-11-20T16:00",
      }),
    ).toMatchObject({
      data: {
        delivery: {
          scheduledInput: "2026-11-20T16:00",
          scheduledAt: "2026-11-20T19:00:00.000Z",
        },
      },
    });
  });

  it("programar solo marca que guarda: la entrega la trae la página revalidada", () => {
    const unscheduled = {
      data: deliveryPanelData(null, context()),
      saving: false,
    };
    expect(optimisticDeliveryPanel(unscheduled, { kind: "schedule" })).toEqual({
      data: unscheduled.data,
      saving: true,
    });
  });
});
