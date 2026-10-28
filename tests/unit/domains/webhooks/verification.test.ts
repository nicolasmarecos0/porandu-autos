import { describe, expect, it } from "vitest";

import {
  CHALLENGE_MAX_LENGTH,
  parseWebhookVerification,
  VERIFY_TOKEN_MAX_LENGTH,
} from "@/domains/webhooks/verification";

/*
 * Query params de la verificación de la suscripción (DEC-039 §1), input no
 * confiable validado con Zod.
 */

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

const VALID = {
  "hub.mode": "subscribe",
  "hub.verify_token": "token-de-prueba-1234",
  "hub.challenge": "1158201444",
};

describe("parseWebhookVerification", () => {
  it("acepta subscribe con token y challenge", () => {
    expect(parseWebhookVerification(params(VALID))).toEqual({
      verifyToken: "token-de-prueba-1234",
      challenge: "1158201444",
    });
  });

  it("ignora otros query params", () => {
    expect(
      parseWebhookVerification(params({ ...VALID, extra: "x" })),
    ).not.toBeNull();
  });

  it("acepta el largo máximo del challenge y del token", () => {
    expect(
      parseWebhookVerification(
        params({
          ...VALID,
          "hub.challenge": "1".repeat(CHALLENGE_MAX_LENGTH),
          "hub.verify_token": "t".repeat(VERIFY_TOKEN_MAX_LENGTH),
        }),
      ),
    ).not.toBeNull();
  });

  it.each(["hub.mode", "hub.verify_token", "hub.challenge"])(
    "rechaza si falta %s",
    (key) => {
      const { [key]: _omitted, ...rest } = VALID as Record<string, string>;
      expect(parseWebhookVerification(params(rest))).toBeNull();
    },
  );

  it.each([
    ["hub.mode distinto de subscribe", { "hub.mode": "unsubscribe" }],
    ["hub.mode en mayúsculas", { "hub.mode": "SUBSCRIBE" }],
    ["hub.mode vacío", { "hub.mode": "" }],
    ["token vacío", { "hub.verify_token": "" }],
    [
      "token demasiado largo",
      { "hub.verify_token": "t".repeat(VERIFY_TOKEN_MAX_LENGTH + 1) },
    ],
    ["challenge vacío", { "hub.challenge": "" }],
    [
      "challenge demasiado largo",
      { "hub.challenge": "1".repeat(CHALLENGE_MAX_LENGTH + 1) },
    ],
    ["challenge con espacios", { "hub.challenge": "11 58" }],
    ["challenge con HTML", { "hub.challenge": "<script>alert(1)</script>" }],
    ["challenge con salto de línea", { "hub.challenge": "11\n58" }],
    ["challenge con comillas", { "hub.challenge": '1"onload="x' }],
    ["challenge con &", { "hub.challenge": "1&2" }],
    ["challenge no ASCII", { "hub.challenge": "chállenge" }],
  ])("rechaza %s", (_, overrides) => {
    expect(
      parseWebhookVerification(params({ ...VALID, ...overrides })),
    ).toBeNull();
  });
});
