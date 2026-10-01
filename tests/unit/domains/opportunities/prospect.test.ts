import { describe, expect, it } from "vitest";

import { initialsOf, maskPhone } from "@/domains/opportunities/prospect";

describe("initialsOf", () => {
  it.each([
    ["Ramón Benítez", "RB"],
    ["María José Rolón", "MR"],
    ["Óscar Brítez", "OB"],
    ["Agroganadera Santa Clara S.A.", "AS"],
    ["  ñandutí   ávila ", "ÑA"],
    ["Sofía", "S"],
    ["", ""],
  ])("%s → %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("maskPhone", () => {
  it.each([
    ["0981 123 214", "0981 ··· 214"],
    ["0981123214", "0981 ··· 214"],
    ["+595 981 123 214", "+595 ··· 214"],
    ["(021) 555-0123", "0215 ··· 123"],
    ["555 0123", "··· 123"],
  ])("%s → %s", (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });

  it("nunca deja ver los dígitos del medio", () => {
    expect(maskPhone("0981123214")).not.toContain("123");
  });

  it("sin dígitos es sin dato", () => {
    expect(maskPhone("")).toBeUndefined();
    expect(maskPhone(" - ")).toBeUndefined();
  });
});
