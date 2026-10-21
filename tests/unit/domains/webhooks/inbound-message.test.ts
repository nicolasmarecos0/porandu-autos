import { describe, expect, it } from "vitest";

import {
  CONTACT_NAME_MAX_LENGTH,
  contactNameFor,
  FALLBACK_CONTACT_NAME,
  normalizeProfileName,
  parseInboundMessage,
  type InboundMessage,
} from "@/domains/webhooks/inbound-message";

/*
 * Contrato propio de un mensaje entrante (Hito 7, DEC-039 §3): estricto y
 * sin la forma del proveedor.
 */

const VALID: InboundMessage = {
  lineId: "100000000000001",
  externalId: "wamid.HBgLNTk1OTgxNTU1MjE0FQIAEhgUM0EwRkQ0",
  from: "595981555214",
  profileName: "Ramón Benítez",
  content: "Hola",
  sentAt: new Date("2026-10-21T12:00:00Z"),
};

describe("parseInboundMessage", () => {
  it("acepta un mensaje válido tal cual", () => {
    expect(parseInboundMessage(VALID)).toEqual(VALID);
    expect(parseInboundMessage({ ...VALID, profileName: null })).toEqual({
      ...VALID,
      profileName: null,
    });
  });

  it("es estricto: un campo de más no pasa", () => {
    expect(
      parseInboundMessage({ ...VALID, organizationId: "otra-organización" }),
    ).toBeNull();
  });

  it.each([
    ["lineId con letras", { lineId: "abc" }],
    ["lineId vacío", { lineId: "" }],
    ["externalId vacío", { externalId: "" }],
    ["externalId con espacios", { externalId: "wamid. x" }],
    ["externalId de más de 256", { externalId: "w".repeat(257) }],
    ["from con +", { from: "+595981555214" }],
    ["from que empieza con 0", { from: "0981555214" }],
    ["from demasiado corto", { from: "59598" }],
    ["from de más de 15 dígitos", { from: "5959815552141234" }],
    ["profileName vacío", { profileName: "" }],
    [
      "profileName de más de 120",
      { profileName: "n".repeat(CONTACT_NAME_MAX_LENGTH + 1) },
    ],
    ["content vacío", { content: "" }],
    ["content de más de 4096", { content: "x".repeat(4097) }],
    ["sentAt inválido", { sentAt: new Date("x") }],
    ["sentAt antes de 2000", { sentAt: new Date("1999-12-31T23:59:59Z") }],
    ["sentAt desde 2100", { sentAt: new Date("2100-01-01T00:00:00Z") }],
    ["sentAt como texto", { sentAt: "2026-10-21T12:00:00Z" }],
  ])("rechaza %s", (_, overrides) => {
    expect(parseInboundMessage({ ...VALID, ...overrides })).toBeNull();
  });
});

describe("normalizeProfileName", () => {
  it("NFC, sin control, espacios colapsados y recortado", () => {
    expect(normalizeProfileName("  Ramén \t\n Benítez\u0007 ")).toBe(
      "Ramén Benítez",
    );
  });

  it("acota a 120 caracteres sin dejar un espacio al final", () => {
    const name = `${"a".repeat(119)} b`;
    expect(normalizeProfileName(name)).toBe("a".repeat(119));
    expect(
      Array.from(normalizeProfileName("🚗".repeat(200)) ?? ""),
    ).toHaveLength(CONTACT_NAME_MAX_LENGTH);
  });

  it("vacío o solo espacios es null", () => {
    expect(normalizeProfileName("")).toBeNull();
    expect(normalizeProfileName(" \n\t ")).toBeNull();
  });
});

describe("contactNameFor", () => {
  it("usa el perfil, o el nombre genérico si no hay", () => {
    expect(contactNameFor(VALID)).toBe("Ramón Benítez");
    expect(contactNameFor({ ...VALID, profileName: null })).toBe(
      FALLBACK_CONTACT_NAME,
    );
  });
});
