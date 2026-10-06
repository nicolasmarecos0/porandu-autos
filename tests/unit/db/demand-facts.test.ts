import { describe, expect, it, vi } from "vitest";

import { isChainConflict } from "@/db/queries/demand-facts";

/*
 * Choques de la cadena humana (H1.4, DEC-030 §4): solo un 23505 sobre los
 * índices de la cadena o un deadlock (40P01) se re-planifican. Cualquier
 * otro error se propaga.
 */

vi.mock("server-only", () => ({}));

function drizzleError(cause: Record<string, unknown>): Error {
  return new Error("Failed query", { cause });
}

describe("isChainConflict", () => {
  it.each([
    [{ code: "40P01" }],
    [
      {
        code: "23505",
        constraint_name: "opportunity_demand_facts_member_root_key",
      },
    ],
    [
      {
        code: "23505",
        constraint_name: "opportunity_demand_facts_member_next_key",
      },
    ],
  ])("re-planifica %j", (cause) => {
    expect(isChainConflict(drizzleError(cause))).toBe(true);
  });

  it.each([
    [
      {
        code: "23505",
        constraint_name: "contacts_organization_id_phone_normalized_key",
      },
    ],
    [{ code: "23505", constraint_name: "opportunity_demand_facts_pkey" }],
    [
      {
        code: "23514",
        constraint_name: "opportunity_demand_facts_value_check",
      },
    ],
    [{ code: "42501" }],
    [{ code: "23503" }],
  ])("no re-planifica %j", (cause) => {
    expect(isChainConflict(drizzleError(cause))).toBe(false);
  });

  it("errores sin causa o que no son Error no son choques", () => {
    expect(isChainConflict(new Error("x"))).toBe(false);
    expect(isChainConflict({ cause: { code: "40P01" } })).toBe(false);
    expect(isChainConflict(null)).toBe(false);
  });
});
