import { describe, expect, it } from "vitest";

import {
  initialsOf,
  maskPhone,
  PROSPECT_AVATARS,
  prospectAvatar,
} from "@/domains/opportunities/prospect";

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

describe("prospectAvatar (DEC-058)", () => {
  const IDS = Array.from(
    { length: 64 },
    (_, index) =>
      `30000000-0000-4000-8000-${String(index * 7919).padStart(12, "0")}`,
  );

  it("el mismo contacto, siempre la misma ilustración", () => {
    for (const id of IDS) {
      expect(prospectAvatar(id)).toBe(prospectAvatar(id));
      expect(prospectAvatar(id.toUpperCase())).toBe(prospectAvatar(id));
    }
  });

  it("solo usa las ilustraciones locales y las reparte", () => {
    const used = new Set(IDS.map(prospectAvatar));
    for (const path of used) {
      expect(PROSPECT_AVATARS).toContain(path);
      expect(path).toMatch(/^\/avatars\/prospect-\d{2}\.svg$/);
    }
    expect(used.size).toBeGreaterThan(4);
  });
});
