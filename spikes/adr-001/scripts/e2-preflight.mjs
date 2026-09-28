/*
 * E2 · preflight de los GitHub Actions secrets. NO imprime ningún valor.
 *
 * Verifica que estén los 5 secrets, que las claves sean las NUEVAS de Supabase
 * (sb_publishable_… / sb_secret_…, no las legacy anon/service_role en JWT) y
 * que el Session pooler y la URL del proyecto apunten al mismo proyecto.
 * Además enmascara la variante URL-encoded de la password de la base (GitHub
 * solo enmascara el valor literal del secret).
 */
import { parseStagingDb } from "../test/support/staging.ts";

const REQUIRED = [
  ["SPIKE_SUPABASE_URL", "STAGING_SUPABASE_URL"],
  ["SPIKE_PUBLISHABLE_KEY", "STAGING_PUBLISHABLE_KEY"],
  ["SPIKE_SECRET_KEY", "STAGING_SECRET_KEY"],
  ["SPIKE_STAGING_DB_PASSWORD", "STAGING_DB_PASSWORD"],
  ["SPIKE_STAGING_POOLER_URL", "STAGING_SESSION_POOLER_URL"],
];

const problems = [];
const value = (name) => process.env[name]?.trim() ?? "";

for (const [envName, secretName] of REQUIRED) {
  if (!value(envName)) problems.push(`falta el secret ${secretName}`);
}

const publishable = value("SPIKE_PUBLISHABLE_KEY");
if (publishable && !publishable.startsWith("sb_publishable_")) {
  problems.push(
    publishable.startsWith("eyJ")
      ? "STAGING_PUBLISHABLE_KEY es la clave legacy `anon` (JWT): usar la Publishable key (sb_publishable_…)"
      : "STAGING_PUBLISHABLE_KEY no empieza con sb_publishable_",
  );
}

const secret = value("SPIKE_SECRET_KEY");
if (secret && !secret.startsWith("sb_secret_")) {
  problems.push(
    secret.startsWith("eyJ")
      ? "STAGING_SECRET_KEY es la clave legacy `service_role` (JWT): usar una Secret key (sb_secret_…)"
      : "STAGING_SECRET_KEY no empieza con sb_secret_",
  );
}

const dbPassword = value("SPIKE_STAGING_DB_PASSWORD");
if (dbPassword.includes("YOUR-PASSWORD")) {
  problems.push(
    "STAGING_DB_PASSWORD contiene el placeholder [YOUR-PASSWORD]: cargar la password real de la base",
  );
}

let db;
if (value("SPIKE_STAGING_POOLER_URL") && value("SPIKE_SUPABASE_URL")) {
  try {
    db = parseStagingDb();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.log(`::error::${problem}`);
  process.exit(1);
}

const encoded = encodeURIComponent(dbPassword);
if (encoded !== dbPassword) console.log(`::add-mask::${encoded}`);

if (db?.region !== "sa-east-1") {
  console.log(
    `::warning::El pooler no parece estar en sa-east-1 (región detectada: ${db?.region ?? "desconocida"})`,
  );
}

console.log(
  [
    "Preflight OK (sin valores):",
    "  5 secrets presentes",
    "  claves: publishable + secret (formato nuevo)",
    "  Session pooler y URL del proyecto: mismo project ref",
    `  región del pooler: ${db?.region ?? "desconocida"}`,
    "  puertos: 5432 (sesión: migraciones y harness) · 6543 (transacción: runtime)",
  ].join("\n"),
);
