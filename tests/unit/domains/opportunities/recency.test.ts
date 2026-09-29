import { describe, expect, it } from "vitest";

import { recencyEmoji } from "@/domains/opportunities/recency";

/*
 * Build Baseline B1 §3.2: 🔥 <5 min · 🟢 5–30 min · 🟡 30 min–2 h · ❄️ >2 h.
 * Los límites exactos de 30 min y 2 h no están definidos en la baseline:
 * se prueban valores dentro de cada rango.
 */
describe("recencyEmoji", () => {
  it.each([
    [0, "🔥"],
    [4, "🔥"],
    [5, "🟢"],
    [15, "🟢"],
    [60, "🟡"],
    [180, "❄️"],
  ])("%i min → %s", (minutes, emoji) => {
    expect(recencyEmoji(minutes)).toBe(emoji);
  });
});
