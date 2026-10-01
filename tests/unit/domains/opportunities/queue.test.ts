import { describe, expect, it } from "vitest";

import {
  bucketFromRecency,
  countByTab,
  groupQueue,
} from "@/domains/opportunities/queue";
import type { Opportunity } from "@/domains/opportunities/types";
import { UNSCORED } from "@/domains/scoring/types";

/*
 * Cola de Opportunities: urgencia temporal derivada de la recencia (H1.1) y
 * orden dentro de cada grupo, con y sin Porandú Score.
 */

function opportunity(
  id: string,
  minutes: number,
  porandu: number | null,
): Opportunity {
  return {
    id,
    prospect: {
      name: id,
      initials: "X",
      channel: "WhatsApp",
      live: false,
    },
    interest: {},
    scores: porandu === null ? UNSCORED : { ...UNSCORED, porandu },
    lastActivity: { minutes },
    stage: "new",
    bucket: bucketFromRecency(minutes),
    drivers: [],
  };
}

describe("bucketFromRecency (regla temporal, B1 §3.2)", () => {
  it.each([
    [0, "now"],
    [4, "now"],
    [29, "now"],
    [30, "today"],
    [119, "today"],
    [120, "followUp"],
    [5000, "followUp"],
  ])("%i min → %s", (minutes, bucket) => {
    expect(bucketFromRecency(minutes)).toBe(bucket);
  });
});

describe("groupQueue", () => {
  it("sin scores (sin dato): la actividad más reciente primero", () => {
    const queue = [
      opportunity("a", 25, null),
      opportunity("b", 3, null),
      opportunity("c", 90, null),
      opportunity("d", 300, null),
      opportunity("e", 12, null),
    ];
    expect(
      groupQueue(queue, "all").map((group) => [
        group.id,
        group.items.map((op) => op.id),
      ]),
    ).toEqual([
      ["now", ["b", "e", "a"]],
      ["today", ["c"]],
      ["followUp", ["d"]],
    ]);
  });

  it("con score: Porandú descendente; sin score, después y por recencia", () => {
    const queue = [
      opportunity("sin-1", 2, null),
      opportunity("p70", 20, 70),
      opportunity("p90", 10, 90),
      opportunity("sin-2", 1, null),
    ];
    expect(groupQueue(queue, "now")[0]?.items.map((op) => op.id)).toEqual([
      "p90",
      "p70",
      "sin-2",
      "sin-1",
    ]);
  });

  it("los grupos vacíos no se muestran y las pestañas cuentan por urgencia", () => {
    const queue = [opportunity("a", 1, null), opportunity("b", 500, null)];
    expect(groupQueue(queue, "today")).toEqual([]);
    expect(countByTab(queue, "all")).toBe(2);
    expect(countByTab(queue, "now")).toBe(1);
    expect(countByTab(queue, "today")).toBe(0);
    expect(countByTab(queue, "followUp")).toBe(1);
  });

  it("0 oportunidades: ningún grupo", () => {
    expect(groupQueue([], "all")).toEqual([]);
    expect(countByTab([], "all")).toBe(0);
  });
});
