import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/*
 * Migraciones oficiales (db/migrations, única fuente) frente al historial
 * de drizzle en la base (`drizzle.__drizzle_migrations`).
 *
 * drizzle-kit guarda por migración aplicada el sha256 del archivo SQL y el
 * `when` del journal (`created_at`), y aplica todo lo que tenga un `when`
 * mayor que el último registrado, sin mirar los hashes. Por eso el preflight
 * exige que el historial sea exactamente un prefijo del journal: mismos
 * archivos, mismo orden. Una fila desconocida, un hash distinto o un hueco
 * abortan antes de migrar.
 */

export type RepoMigration = Readonly<{
  idx: number;
  tag: string;
  /** `when` del journal: lo que drizzle guarda como `created_at`. */
  when: number;
  /** sha256 del archivo SQL, igual que drizzle-orm (migrator.js). */
  hash: string;
}>;

export type AppliedMigration = Readonly<{
  id: number;
  hash: string;
  createdAt: number;
}>;

export type HistoryStatus =
  | Readonly<{
      kind: "consistent";
      applied: readonly RepoMigration[];
      pending: readonly RepoMigration[];
    }>
  | Readonly<{ kind: "inconsistent"; reason: string }>;

type JournalEntry = { idx: number; tag: string; when: number };

export const MIGRATIONS_FOLDER = new URL(
  "../../db/migrations/",
  import.meta.url,
);

export function readRepoMigrations(
  folder: URL = MIGRATIONS_FOLDER,
): RepoMigration[] {
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", folder), "utf8"),
  ) as { entries: JournalEntry[] };

  const migrations = journal.entries.map((entry) => {
    const sql = readFileSync(new URL(`${entry.tag}.sql`, folder)).toString();
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });

  migrations.forEach((migration, position) => {
    const previous = migrations[position - 1];
    if (
      migration.idx !== position ||
      (previous && previous.when >= migration.when)
    ) {
      throw new Error(
        "db/migrations/meta/_journal.json is not ordered (idx and when must increase).",
      );
    }
  });
  return migrations;
}

/**
 * Compara el historial de la base con el journal. `applied` puede venir en
 * cualquier orden; se ordena como lo lee drizzle (`created_at`).
 */
export function compareHistory(
  repo: readonly RepoMigration[],
  applied: readonly AppliedMigration[],
): HistoryStatus {
  const rows = [...applied].sort(
    (a, b) => a.createdAt - b.createdAt || a.id - b.id,
  );
  if (rows.length > repo.length) {
    return {
      kind: "inconsistent",
      reason: `the database has ${rows.length} applied migrations, the repository only ${repo.length}.`,
    };
  }
  for (const [position, row] of rows.entries()) {
    const expected = repo[position];
    if (!expected || row.createdAt !== expected.when) {
      return {
        kind: "inconsistent",
        reason: `applied migration #${position + 1} (created_at ${row.createdAt}) is not ${expected?.tag ?? "in the journal"}.`,
      };
    }
    if (row.hash !== expected.hash) {
      return {
        kind: "inconsistent",
        reason: `applied migration ${expected.tag} has a different hash than db/migrations/${expected.tag}.sql.`,
      };
    }
  }
  return {
    kind: "consistent",
    applied: repo.slice(0, rows.length),
    pending: repo.slice(rows.length),
  };
}

/** Input `expected_migrations`: tags separados por coma. */
export function parseExpectedMigrations(raw: string | undefined): string[] {
  const tags = (raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  if (new Set(tags).size !== tags.length) {
    throw new Error("expected_migrations has duplicated tags.");
  }
  return tags;
}

/**
 * Lo pendiente tiene que ser exactamente lo que declaró quien dispara la
 * migración: nada de más (una migración mergeada que no se quería aplicar)
 * y nada de menos.
 */
export function pendingMismatch(
  pending: readonly RepoMigration[],
  expected: readonly string[],
): string | null {
  const actual = pending.map((migration) => migration.tag);
  if (expected.length === 0) {
    return "expected_migrations is required for migrate (comma-separated tags).";
  }
  if (
    actual.length !== expected.length ||
    actual.some((tag, position) => tag !== expected[position])
  ) {
    return `pending migrations are [${actual.join(", ")}], expected [${expected.join(", ")}].`;
  }
  return null;
}

/** Tablas, enums y policies de `public` según el snapshot de drizzle-kit. */
export type SchemaFootprint = Readonly<{
  tables: readonly string[];
  enums: readonly string[];
  policies: readonly string[];
}>;

type Snapshot = {
  tables: Record<
    string,
    { schema: string; name: string; policies: Record<string, unknown> }
  >;
  enums: Record<string, { schema: string; name: string }>;
  views?: Record<string, { schema: string; name: string }>;
};

/**
 * Lo que las migraciones aplicadas dejan en `public`, según el snapshot de
 * la última (db/migrations/meta). El SQL custom (schema `private`,
 * funciones, roles) no figura en el snapshot: lo cubren el preflight y la
 * verificación de catálogo.
 */
export function expectedFootprint(
  applied: readonly RepoMigration[],
  folder: URL = MIGRATIONS_FOLDER,
): SchemaFootprint {
  const last = applied.at(-1);
  if (!last) return { tables: [], enums: [], policies: [] };
  const snapshot = JSON.parse(
    readFileSync(
      new URL(
        `meta/${String(last.idx).padStart(4, "0")}_snapshot.json`,
        folder,
      ),
      "utf8",
    ),
  ) as Snapshot;

  const inPublic = (entry: { schema: string }) =>
    entry.schema === "" || entry.schema === "public";
  const tables = Object.values(snapshot.tables).filter(inPublic);
  const views = Object.values(snapshot.views ?? {}).filter(inPublic);
  return {
    tables: [...tables, ...views].map((t) => t.name).sort(),
    enums: Object.values(snapshot.enums)
      .filter(inPublic)
      .map((e) => e.name)
      .sort(),
    policies: tables
      .flatMap((t) => Object.keys(t.policies).map((p) => `${t.name}.${p}`))
      .sort(),
  };
}
