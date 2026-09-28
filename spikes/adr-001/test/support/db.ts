import postgres from "postgres";

/*
 * Conexiones crudas del harness (postgres-js, sin Drizzle ni withTenant).
 * Los tests SQL/RLS fijan la identidad A MANO para probar el contrato de la
 * base de datos independientemente del código de la aplicación.
 */

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function openSql(url: string, label: string, max = 4): Sql {
  return postgres(url, {
    max,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    connection: { application_name: `porandu-spike-${label}` },
    onnotice: () => undefined,
  });
}

class Rollback extends Error {}

type AsRoleOptions = {
  /** Por defecto la transacción se revierte: los tests no dejan residuos. */
  readonly commit?: boolean;
};

/**
 * BEGIN; SET LOCAL ROLE <role>; set_config('request.jwt.claims', …, true); fn; ROLLBACK.
 * `claims = null` simula una request sin identidad.
 */
export async function asRole<T>(
  sql: Sql,
  role: "authenticated" | "anon",
  claims: Record<string, unknown> | null,
  fn: (tx: Tx) => Promise<T>,
  options: AsRoleOptions = {},
): Promise<T> {
  let result: { value: T } | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      if (claims) {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      }
      result = { value: await fn(tx) };
      if (!options.commit) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!result) throw new Error("asRole sin resultado");
  return result.value;
}

export function asUser<T>(
  sql: Sql,
  claims: Record<string, unknown> | null,
  fn: (tx: Tx) => Promise<T>,
  options: AsRoleOptions = {},
): Promise<T> {
  return asRole(sql, "authenticated", claims, fn, options);
}

/** Identidad observable de una conexión FUERA de cualquier transacción. */
export async function connectionIdentity(sql: Sql): Promise<{
  currentUser: string;
  sessionUser: string;
  claims: string;
  pid: number;
}> {
  const [row] = await sql<
    { cu: string; su: string; claims: string; pid: number }[]
  >`select current_user as cu, session_user as su,
           coalesce(current_setting('request.jwt.claims', true), '') as claims,
           pg_backend_pid() as pid`;
  if (!row) throw new Error("sin fila");
  return {
    currentUser: row.cu,
    sessionUser: row.su,
    claims: row.claims,
    pid: row.pid,
  };
}
