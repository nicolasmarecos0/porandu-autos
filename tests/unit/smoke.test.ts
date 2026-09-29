import { describe, expect, it } from "vitest";

import { recencyEmoji } from "@/domains/opportunities/recency";

describe("test runner", () => {
  it("runs in Node, without DOM globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("resolves the @/ alias like tsconfig.json", () => {
    expect(recencyEmoji).toBeTypeOf("function");
  });
});
