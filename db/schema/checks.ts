import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * `column IN ('a', 'b', …)` con literales fijos del código, para un CHECK
 * que una migración puede reemplazar cuando el conjunto cambie (en vez de un
 * enum de Postgres). Un NULL pasa el CHECK: la obligatoriedad la da NOT NULL.
 */
export function oneOf(column: PgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}
