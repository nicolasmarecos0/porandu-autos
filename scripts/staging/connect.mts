import postgres, { type Sql, type TransactionSql } from "postgres";

/*
 * Conexiones del tooling de staging. Una sola conexión por proceso, con
 * nombre de aplicación para identificarla en los logs de Supabase.
 * `prepare: false` también en el Session pooler: el mismo cliente sirve para
 * el Transaction pooler (6543), que no soporta prepared statements con
 * nombre (ADR-001 §4).
 */

export const APPLICATION_NAME = "porandu-staging-db";

export function connect(url: string): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 20,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: APPLICATION_NAME },
  });
}

/**
 * Ejecuta `fn` en una transacción READ ONLY con timeouts cortos. Preflight y
 * verificación no pueden escribir nada aunque quisieran.
 */
export function readOnly<T>(
  sql: Sql,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin("read only", async (tx) => {
    await tx`SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '5s', true)`;
    return fn(tx);
  }) as Promise<T>;
}
