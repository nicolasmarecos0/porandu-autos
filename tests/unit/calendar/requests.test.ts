import { describe, expect, it } from "vitest";

import {
  parseScheduleRequest,
  parseStatusChangeRequest,
} from "@/lib/calendar/requests";

/*
 * Pedidos de las Server Actions de la agenda (Hito 9, DEC-041 §3): input no
 * confiable. Solo se leen la oportunidad, la unidad y la hora (alta) o el
 * id, el estado de partida y el destino (cambio). Organización, autor y
 * estado inicial nunca salen del pedido.
 */

const NOW = new Date("2026-11-02T13:00:00Z");
const OPPORTUNITY = "6f1c2b0a-1d2e-4f3a-8b9c-0d1e2f3a4b5c";
const VEHICLE = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("parseScheduleRequest", () => {
  it("acepta un pedido válido e ignora organización, autor y estado", () => {
    const parsed = parseScheduleRequest(
      form({
        opportunityId: OPPORTUNITY.toUpperCase(),
        vehicleId: VEHICLE,
        scheduledAt: "2026-11-03T10:00",
        organizationId: "otra",
        createdBy: "otro",
        status: "completed",
      }),
      NOW,
    );
    expect(parsed).toEqual({
      ok: true,
      opportunityId: OPPORTUNITY,
      vehicleId: VEHICLE,
      scheduledAt: new Date("2026-11-03T13:00:00Z"),
      values: {
        opportunityId: OPPORTUNITY.toUpperCase(),
        vehicleId: VEHICLE,
        scheduledAt: "2026-11-03T10:00",
      },
    });
  });

  it("marca cada campo faltante o inválido y devuelve lo cargado", () => {
    expect(parseScheduleRequest(form({}), NOW)).toEqual({
      ok: false,
      errors: {
        opportunityId: "required",
        vehicleId: "required",
        scheduledAt: "required",
      },
      values: { opportunityId: "", vehicleId: "", scheduledAt: "" },
    });
    expect(
      parseScheduleRequest(
        form({
          opportunityId: OPPORTUNITY,
          vehicleId: "no-es-uuid",
          scheduledAt: "2026-11-01T10:00",
        }),
        NOW,
      ),
    ).toMatchObject({
      ok: false,
      errors: { vehicleId: "required", scheduledAt: "in_the_past" },
    });
  });
});

describe("parseStatusChangeRequest", () => {
  it("lee el id, el estado de partida y el destino", () => {
    expect(
      parseStatusChangeRequest(
        form({ testDriveId: OPPORTUNITY, from: "scheduled", to: "confirmed" }),
      ),
    ).toEqual({
      ok: true,
      testDriveId: OPPORTUNITY,
      from: "scheduled",
      to: "confirmed",
    });
  });

  it("un id o un estado desconocidos no llegan a la base", () => {
    for (const entries of <Record<string, string>[]>[
      { testDriveId: "x", from: "scheduled", to: "confirmed" },
      { testDriveId: OPPORTUNITY, from: "draft", to: "confirmed" },
      { testDriveId: OPPORTUNITY, from: "scheduled", to: "deleted" },
      { testDriveId: OPPORTUNITY, from: "scheduled" },
    ]) {
      expect(parseStatusChangeRequest(form(entries))).toEqual({ ok: false });
    }
  });
});
