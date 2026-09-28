import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/*
 * Conexión de runtime del spike: SIEMPRE con el rol `app_runtime`.
 *
 * Diferencia con el producto previsto: en el producto habrá un único cliente
 * server-only construido desde el env (db/client.ts). El spike usa una factory
 * para comparar la conexión directa contra el pooler con el mismo código.
 * Este módulo no conoce la credencial de migración.
 */

export type RuntimeDb = {
  readonly label: string;
  readonly db: ReturnType<typeof drizzle>;
  readonly sql: postgres.Sql;
  close(): Promise<void>;
};

export function createRuntimeDb(
  url: string,
  options: { label: string; max?: number },
): RuntimeDb {
  const sql = postgres(url, {
    max: options.max ?? 10,
    // Supavisor en modo transacción no soporta prepared statements con nombre.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    connection: { application_name: `porandu-spike-runtime:${options.label}` },
    onnotice: () => undefined,
  });
  return {
    label: options.label,
    db: drizzle(sql),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
