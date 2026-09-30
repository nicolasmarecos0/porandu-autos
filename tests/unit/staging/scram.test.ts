import { describe, expect, it } from "vitest";

import {
  parseScramVerifier,
  SCRAM_VERIFIER,
  scramSha256Verifier,
} from "../../../scripts/staging/scram.mts";

/*
 * Verificador SCRAM-SHA-256 de app_runtime (scripts/staging/scram.mts). El
 * vector lo calculó PostgreSQL 17 (`ALTER ROLE … PASSWORD 'pencil'` con
 * password_encryption = scram-sha-256); tests/db/staging-tooling.test.ts lo
 * vuelve a comparar contra la base en cada corrida.
 */

const POSTGRES_VECTOR =
  "SCRAM-SHA-256$4096:GEoxqyqIuk5ScEZ2gtPxYw==$OnX2/2/ZAmrt7Aj69bLvp4qpDMkF1C3JAiUkaSzz6XI=:SxTUXSW74Nb8ZFpsw5j61zfIgDyqlbNgwMEfmFiTWJE=";

describe("scramSha256Verifier", () => {
  it("coincide con el verificador que calcula PostgreSQL", () => {
    const parsed = parseScramVerifier(POSTGRES_VECTOR);
    expect(parsed?.iterations).toBe(4096);
    expect(
      scramSha256Verifier("pencil", parsed?.salt, parsed?.iterations),
    ).toBe(POSTGRES_VECTOR);
  });

  it("usa un salt aleatorio por llamada y el formato que acepta ALTER ROLE", () => {
    const a = scramSha256Verifier("x".repeat(40));
    const b = scramSha256Verifier("x".repeat(40));
    expect(a).toMatch(SCRAM_VERIFIER);
    expect(a).not.toBe(b);
    expect(a).not.toContain("x".repeat(40));
    expect(a).not.toContain("'");
  });

  it("rechaza passwords que SASLprep normalizaría distinto", () => {
    expect(() => scramSha256Verifier("contraseña")).toThrow(/printable ASCII/);
    expect(() => scramSha256Verifier("with space")).toThrow(/printable ASCII/);
  });

  it("parseScramVerifier rechaza lo que no es un verificador", () => {
    expect(parseScramVerifier("md5abc")).toBeNull();
    expect(parseScramVerifier("pencil")).toBeNull();
  });
});
