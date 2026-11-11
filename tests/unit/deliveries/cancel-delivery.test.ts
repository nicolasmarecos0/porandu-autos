import { beforeEach, describe, expect, it, vi } from "vitest";

import { planDeliveryCancellation } from "@/domains/opportunities/deliveries";
import { cancelDelivery } from "@/lib/deliveries/actions";

/*
 * Anular una entrega (Hito 22, DEC-054 §4), sin base de datos: solo una
 * pendiente, y solo un admin. Contra PostgreSQL (policy de DELETE y trigger
 * que conserva las completadas) en tests/db/security-roles.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  role: "seller" as "admin" | "seller",
  requireTenant: vi.fn(),
  deleteDelivery: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/deliveries-write", () => ({
  completeDeliveryWithExit: vi.fn(),
  deleteDelivery: mocks.deleteDelivery,
  insertDelivery: vi.fn(),
  writeDeliveryChecklistItem: vi.fn(),
  writeDeliverySchedule: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000001";
const DELIVERY = "50000000-0000-4000-8000-000000000001";

function form(deliveryId: string): FormData {
  const data = new FormData();
  data.set("deliveryId", deliveryId);
  return data;
}

beforeEach(() => {
  mocks.role = "seller";
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => ({
    organizationId: ORG,
    role: mocks.role,
  }));
  mocks.deleteDelivery.mockReset();
  mocks.deleteDelivery.mockResolvedValue({
    outcome: "cancelled",
    opportunityId: OPPORTUNITY,
  });
  mocks.revalidatePath.mockReset();
});

describe("planDeliveryCancellation()", () => {
  it("una pendiente se anula; una completada, nunca", () => {
    expect(planDeliveryCancellation({ status: "pending" })).toEqual({
      kind: "cancel",
    });
    expect(planDeliveryCancellation({ status: "completed" })).toEqual({
      kind: "already_completed",
    });
  });
});

describe("cancelDelivery()", () => {
  it("un seller recibe UNAUTHORIZED_ROLE sin llegar a la base", async () => {
    expect(await cancelDelivery(null, form(DELIVERY))).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "delivery.cancel",
    });
    expect(mocks.deleteDelivery).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un admin anula y revalida el detalle y el embudo", async () => {
    mocks.role = "admin";
    expect(await cancelDelivery(null, form(DELIVERY))).toEqual({
      status: "cancelled",
    });
    expect(mocks.deleteDelivery.mock.calls[0]![1]).toBe(DELIVERY);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/opportunities/${OPPORTUNITY}`,
    );
  });

  it.each([
    [
      { outcome: "already_completed", opportunityId: OPPORTUNITY },
      { status: "already_completed" },
    ],
    [
      { outcome: "unauthorized_role", opportunityId: OPPORTUNITY },
      {
        status: "unauthorized_role",
        code: "UNAUTHORIZED_ROLE",
        capability: "delivery.cancel",
      },
    ],
    [{ outcome: "not_found" }, { status: "not_found" }],
  ] as const)("%o → %o", async (outcome, state) => {
    mocks.role = "admin";
    mocks.deleteDelivery.mockResolvedValue(outcome);
    expect(await cancelDelivery(null, form(DELIVERY))).toEqual(state);
  });

  it("un id malformado es not_found; una falla inesperada, failed", async () => {
    mocks.role = "admin";
    expect(await cancelDelivery(null, form("x"))).toEqual({
      status: "not_found",
    });
    mocks.deleteDelivery.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await cancelDelivery(null, form(DELIVERY))).toEqual({
      status: "failed",
    });
  });
});
