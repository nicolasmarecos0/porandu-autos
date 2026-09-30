import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/*
 * Verificador SCRAM-SHA-256 (RFC 5802 / RFC 7677) en el formato que guarda
 * PostgreSQL en pg_authid.rolpassword:
 *
 *   SCRAM-SHA-256$<iteraciones>:<salt>$<StoredKey>:<ServerKey>
 *
 * Es lo mismo que hace `\password` de psql: la password se hashea del lado
 * del cliente y a la base solo llega el verificador. Supabase registra el
 * `ALTER ROLE` completo en el log de Postgres (visto con supabase/postgres
 * 17, incluso con log_statement = none): así, el texto plano nunca sale del
 * runner. Con el verificador no se puede iniciar sesión: hace falta la
 * password.
 */

export const SCRAM_ITERATIONS = 4096;

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
export const SCRAM_VERIFIER =
  /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

function hmac(key: Buffer, message: string): Buffer {
  return createHmac("sha256", key).update(message).digest();
}

export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations: number = SCRAM_ITERATIONS,
): string {
  // SASLprep deja igual a un ASCII imprimible; cualquier otra cosa se rechaza
  // en vez de normalizarse distinto que PostgreSQL.
  if (!PRINTABLE_ASCII.test(password)) {
    throw new Error("SCRAM: the password must be printable ASCII.");
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256")
    .update(hmac(salted, "Client Key"))
    .digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** Salt e iteraciones de un verificador existente (para compararlo). */
export function parseScramVerifier(
  verifier: string,
): { iterations: number; salt: Buffer } | null {
  const match = SCRAM_VERIFIER.exec(verifier);
  if (!match) return null;
  return {
    iterations: Number(match[1]),
    salt: Buffer.from(match[2] ?? "", "base64"),
  };
}
