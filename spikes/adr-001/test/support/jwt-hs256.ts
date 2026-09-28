import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * JWT HS256 mínimo con node:crypto. Uso:
 *   - e0: firma y verifica los tokens del shim (no hay servidor de Auth).
 *   - e1: firmar un token VENCIDO con el JWT secret local para comprobar que
 *     getClaims() lo rechaza (solo si Auth local firma con HS256).
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signHs256(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyHs256(
  token: string,
  secret: string,
): Record<string, unknown> {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) throw new Error("token mal formado");
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("firma inválida");
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString(),
  ) as Record<string, unknown>;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new Error("token vencido");
  }
  return payload;
}

export function decodeJwtPart(
  token: string,
  part: 0 | 1,
): Record<string, unknown> {
  const segment = token.split(".")[part];
  if (!segment) throw new Error("token mal formado");
  return JSON.parse(Buffer.from(segment, "base64url").toString()) as Record<
    string,
    unknown
  >;
}

/** Reemplaza el payload manteniendo header y firma originales (token adulterado). */
export function tamperPayload(
  token: string,
  patch: Record<string, unknown>,
): string {
  const [header, , signature] = token.split(".");
  const payload = { ...decodeJwtPart(token, 1), ...patch };
  return `${header}.${b64url(JSON.stringify(payload))}.${signature}`;
}
