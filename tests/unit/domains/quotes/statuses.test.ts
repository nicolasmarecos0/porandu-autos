import { describe, expect, it } from "vitest";

import {
  quoteCurrencies,
  quoteDiscountKinds,
  quoteMaxDiscountPercent,
  quoteMaxValidityDays,
  quoteNotesMaxLength,
  quoteStatuses,
} from "@/db/schema/quotes";
import { CURRENCIES } from "@/domains/money";
import { DISCOUNT_KINDS, MAX_DISCOUNT_PERCENT } from "@/domains/quotes/pricing";
import {
  MAX_VALIDITY_DAYS,
  QUOTE_NOTES_MAX_LENGTH,
} from "@/domains/quotes/request";
import {
  availableQuoteTransitions,
  isOpenQuoteStatus,
  planQuoteTransition,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  quoteDisplayLabel,
  quoteDisplayStatus,
  type QuoteTransitionTarget,
} from "@/domains/quotes/statuses";

/*
 * Estados de una cotización (Hito 10, DEC-042 §2). El trigger
 * quotes_status_transition espeja esta matriz (tests/db/quotes.test.ts
 * recorre todos los pares contra la base).
 */

const TODAY = "2026-11-01";

const target = (
  overrides: Partial<QuoteTransitionTarget> = {},
): QuoteTransitionTarget => ({
  status: "draft",
  validUntil: "2026-11-08",
  opportunityStage: "negotiating",
  vehicleStatus: "available",
  requiresAdmin: false,
  ...overrides,
});

const seller = { isAdmin: false };
const admin = { isAdmin: true };

describe("el schema espeja el dominio", () => {
  it("estados, tipos de descuento, monedas y límites", () => {
    expect([...quoteStatuses]).toEqual([...QUOTE_STATUSES]);
    expect([...quoteDiscountKinds]).toEqual([...DISCOUNT_KINDS]);
    expect([...quoteCurrencies]).toEqual([...CURRENCIES]);
    expect(quoteMaxDiscountPercent).toBe(MAX_DISCOUNT_PERCENT);
    expect(quoteMaxValidityDays).toBe(MAX_VALIDITY_DAYS);
    expect(quoteNotesMaxLength).toBe(QUOTE_NOTES_MAX_LENGTH);
  });
});

describe("matriz", () => {
  it("nada se envía sin aprobar y los terminales no se reabren", () => {
    expect(QUOTE_TRANSITIONS.draft).not.toContain("sent");
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      expect(QUOTE_TRANSITIONS[status]).toEqual([]);
      expect(isOpenQuoteStatus(status)).toBe(false);
    }
  });

  it("quedarse en el mismo estado no es un pase", () => {
    for (const status of QUOTE_STATUSES) {
      expect(
        planQuoteTransition(target({ status }), status, admin, TODAY),
      ).toEqual({ ok: false, error: "invalid_transition" });
    }
  });
});

describe("planQuoteTransition", () => {
  it("aprobar, enviar y aceptar exigen validez y oportunidad abierta", () => {
    expect(
      planQuoteTransition(
        target({ validUntil: "2026-10-31" }),
        "approved",
        admin,
        TODAY,
      ),
    ).toEqual({ ok: false, error: "expired" });
    // El último día de validez es inclusive.
    expect(
      planQuoteTransition(
        target({ validUntil: TODAY }),
        "approved",
        admin,
        TODAY,
      ).ok,
    ).toBe(true);
    for (const stage of ["new", "won", "lost"] as const) {
      expect(
        planQuoteTransition(
          target({ status: "approved", opportunityStage: stage }),
          "sent",
          admin,
          TODAY,
        ),
      ).toEqual({ ok: false, error: "opportunity_closed" });
    }
  });

  it("rechazar o anular siempre se puede, aunque esté vencida o cerrada", () => {
    const stale = target({
      status: "sent",
      validUntil: "2026-01-01",
      opportunityStage: "lost",
      vehicleStatus: "sold",
    });
    expect(planQuoteTransition(stale, "rejected", seller, TODAY).ok).toBe(true);
    expect(planQuoteTransition(stale, "withdrawn", seller, TODAY).ok).toBe(
      true,
    );
  });

  it("aceptar exige la unidad en stock", () => {
    expect(
      planQuoteTransition(
        target({ status: "sent", vehicleStatus: "sold" }),
        "accepted",
        seller,
        TODAY,
      ),
    ).toEqual({ ok: false, error: "vehicle_unavailable" });
    expect(
      planQuoteTransition(
        target({ status: "sent", vehicleStatus: "reserved" }),
        "accepted",
        seller,
        TODAY,
      ),
    ).toEqual({ ok: true, from: "sent", to: "accepted" });
  });

  it("un descuento sobre el límite lo aprueba solo un admin", () => {
    const big = target({ requiresAdmin: true });
    expect(planQuoteTransition(big, "approved", seller, TODAY)).toEqual({
      ok: false,
      error: "requires_admin",
    });
    expect(planQuoteTransition(big, "approved", admin, TODAY).ok).toBe(true);
    expect(availableQuoteTransitions(big, seller, TODAY)).toEqual([
      "withdrawn",
    ]);
    expect(availableQuoteTransitions(big, admin, TODAY)).toEqual([
      "approved",
      "withdrawn",
    ]);
  });
});

describe("estado para mostrar", () => {
  it("una abierta vencida se ve Vencida; una terminal conserva su estado", () => {
    expect(quoteDisplayStatus("sent", "2026-10-31", TODAY)).toBe("expired");
    expect(quoteDisplayLabel("expired")).toBe("Vencida");
    expect(quoteDisplayStatus("accepted", "2026-10-31", TODAY)).toBe(
      "accepted",
    );
    expect(quoteDisplayLabel("draft")).toBe("Borrador");
  });
});
