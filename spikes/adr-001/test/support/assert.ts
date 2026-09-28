import { expect } from "vitest";

/*
 * Drizzle 0.45 envuelve los errores del driver en DrizzleQueryError (`cause`).
 * Se recorre la cadena para encontrar el SQLSTATE de Postgres.
 */
export function pgErrorOf(error: unknown): {
  code: string | undefined;
  message: string;
} {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        const message = (current as { message?: unknown }).message;
        return { code, message: String(message) };
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return {
    code: undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `se esperaba error ${code}`).toBeDefined();
  const pg = pgErrorOf(caught);
  expect(pg.code, pg.message).toBe(code);
  if (message) expect(pg.message).toMatch(message);
}

/** "Sin identidad" puede resolverse como 0 filas o como error: nunca con filas. */
export async function expectNoRowsOrError(
  promise: Promise<readonly unknown[]>,
): Promise<"no-rows" | "error"> {
  try {
    const rows = await promise;
    expect(rows).toHaveLength(0);
    return "no-rows";
  } catch (error) {
    expect(pgErrorOf(error).code).toBeDefined();
    return "error";
  }
}
