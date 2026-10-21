import { describe, expect, it, vi } from "vitest";

import { isValidSignature } from "@/lib/whatsapp/signature";

import { signature, TEST_APP_SECRET } from "../support/whatsapp-payload";

/*
 * Firma del webhook (Hito 7, DEC-039 §2): HMAC-SHA256 del cuerpo crudo con
 * el secreto compartido, en `X-Hub-Signature-256: sha256=<hex>`.
 */

vi.mock("server-only", () => ({}));

const BODY = '{"object":"whatsapp_business_account","entry":[]}';
const bytes = (text: string) => new TextEncoder().encode(text);

describe("isValidSignature", () => {
  it("acepta la firma del cuerpo con el secreto", () => {
    expect(
      isValidSignature(bytes(BODY), signature(BODY), TEST_APP_SECRET),
    ).toBe(true);
  });

  it("acepta el hex en mayúsculas y espacios en los bordes del header", () => {
    const header = ` sha256=${signature(BODY).slice(7).toUpperCase()} `;
    expect(isValidSignature(bytes(BODY), header, TEST_APP_SECRET)).toBe(true);
  });

  it("rechaza sin header", () => {
    expect(isValidSignature(bytes(BODY), null, TEST_APP_SECRET)).toBe(false);
  });

  it("rechaza un cuerpo alterado (un byte)", () => {
    const tampered = BODY.replace("entry", "entrx");
    expect(
      isValidSignature(bytes(tampered), signature(BODY), TEST_APP_SECRET),
    ).toBe(false);
  });

  it("rechaza la firma hecha con otro secreto", () => {
    expect(
      isValidSignature(
        bytes(BODY),
        signature(BODY, "another-secret-another-secret-xx"),
        TEST_APP_SECRET,
      ),
    ).toBe(false);
  });

  it.each([
    ["sin prefijo", signature(BODY).slice(7)],
    ["otro algoritmo", signature(BODY).replace("sha256=", "sha1=")],
    ["hex corto", signature(BODY).slice(0, -2)],
    ["hex largo", `${signature(BODY)}00`],
    ["no hex", `sha256=${"z".repeat(64)}`],
    ["vacío", ""],
  ])("rechaza un header mal formado: %s", (_, header) => {
    expect(isValidSignature(bytes(BODY), header, TEST_APP_SECRET)).toBe(false);
  });
});
