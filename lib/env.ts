/*
 * Contrato de variables de entorno (H0).
 *
 * Este módulo solo contiene validación pura: recibe un objeto de entorno y
 * no lee `process.env` por su cuenta. Los puntos de lectura son:
 *   - `lib/env.public.ts`: variables públicas (navegador y servidor).
 *   - `lib/env.server.ts`: variables server-only (`import "server-only"`).
 *
 * `MIGRATION_DATABASE_URL` (rol `postgres`) no forma parte de este contrato:
 * es exclusiva de drizzle-kit y el runtime nunca la referencia (ADR-001 §2
 * y §3.1). Los mensajes de error nombran la variable, nunca su valor.
 *
 * `WHATSAPP_APP_SECRET` (Hito 7, DEC-039 §2) y `WHATSAPP_VERIFY_TOKEN`
 * (verificación de la suscripción) se validan aparte: solo las usa el
 * webhook de WhatsApp, que falla cerrado sin ellas sin bloquear el resto de
 * la aplicación. Lo mismo `WHATSAPP_API_TOKEN` (Hito 8, DEC-040 §5): solo lo
 * usa el envío de mensajes.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type ServerEnv = {
  runtimeDatabaseUrl: string;
};

export type WhatsAppEnv = {
  appSecret: string;
};

export type WhatsAppVerifyEnv = {
  verifyToken: string;
};

export type WhatsAppApiEnv = {
  apiToken: string;
};

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((i) => `- ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

const RUNTIME_ROLE = "app_runtime";
/** Largo mínimo del secreto del webhook (el app secret de Meta tiene 32). */
const WHATSAPP_SECRET_MIN_LENGTH = 32;
/** Largo mínimo del token de verificación de la suscripción. */
const WHATSAPP_VERIFY_TOKEN_MIN_LENGTH = 16;
/** Largo mínimo del token de la Cloud API (los de Meta son mucho más largos). */
const WHATSAPP_API_TOKEN_MIN_LENGTH = 32;
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

function readRequired(
  source: EnvSource,
  name: string,
  issues: string[],
): string {
  const value = source[name]?.trim() ?? "";
  if (value === "") issues.push(`${name} is required.`);
  return value;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Supavisor autentica como `<rol>.<project_ref>`; la conexión directa, como
 * `<rol>`. En ambos casos el rol es lo anterior al primer punto.
 */
export function databaseRole(url: URL): string {
  return decodeURIComponent(url.username).split(".")[0] ?? "";
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const issues: string[] = [];

  const supabaseUrl = readRequired(source, "NEXT_PUBLIC_SUPABASE_URL", issues);
  if (supabaseUrl !== "") {
    const url = parseUrl(supabaseUrl);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      issues.push("NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL.");
    }
  }

  const supabasePublishableKey = readRequired(
    source,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    issues,
  );
  // Una variable NEXT_PUBLIC_* termina en el bundle del navegador: solo se
  // acepta una publishable key, nunca una secret key ni una key legacy.
  if (
    supabasePublishableKey !== "" &&
    !supabasePublishableKey.startsWith(PUBLISHABLE_KEY_PREFIX)
  ) {
    issues.push(
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key (${PUBLISHABLE_KEY_PREFIX}…).`,
    );
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { supabaseUrl, supabasePublishableKey };
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  const issues: string[] = [];

  const runtimeDatabaseUrl = readRequired(
    source,
    "RUNTIME_DATABASE_URL",
    issues,
  );
  if (runtimeDatabaseUrl !== "") {
    const url = parseUrl(runtimeDatabaseUrl);
    if (
      !url ||
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    ) {
      issues.push("RUNTIME_DATABASE_URL must be a postgres:// URL.");
    } else if (databaseRole(url) !== RUNTIME_ROLE) {
      // ADR-001 §3.1: el runtime se conecta siempre como app_runtime y nunca
      // con la credencial de migración (postgres).
      issues.push(
        `RUNTIME_DATABASE_URL must connect as ${RUNTIME_ROLE} (ADR-001). The postgres role is reserved for migrations.`,
      );
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { runtimeDatabaseUrl };
}

/**
 * Secreto compartido con el que el proveedor firma cada webhook
 * (`X-Hub-Signature-256`, HMAC-SHA256 del cuerpo). Server-only: nunca lleva
 * prefijo NEXT_PUBLIC_ ni se registra.
 */
export function parseWhatsAppEnv(source: EnvSource): WhatsAppEnv {
  const issues: string[] = [];
  const appSecret = readRequired(source, "WHATSAPP_APP_SECRET", issues);
  if (appSecret !== "" && appSecret.length < WHATSAPP_SECRET_MIN_LENGTH) {
    issues.push(
      `WHATSAPP_APP_SECRET must be at least ${WHATSAPP_SECRET_MIN_LENGTH} characters long.`,
    );
  }
  if (issues.length > 0) throw new EnvValidationError(issues);
  return { appSecret };
}

/**
 * Token que el administrador configura en Meta al suscribir el webhook y que
 * Meta devuelve en el GET de verificación (`hub.verify_token`). Distinto del
 * app secret: este viaja en la URL de Meta, así que no sirve para firmar.
 * Server-only: nunca lleva prefijo NEXT_PUBLIC_ ni se registra.
 */
export function parseWhatsAppVerifyEnv(source: EnvSource): WhatsAppVerifyEnv {
  const issues: string[] = [];
  const verifyToken = readRequired(source, "WHATSAPP_VERIFY_TOKEN", issues);
  if (
    verifyToken !== "" &&
    verifyToken.length < WHATSAPP_VERIFY_TOKEN_MIN_LENGTH
  ) {
    issues.push(
      `WHATSAPP_VERIFY_TOKEN must be at least ${WHATSAPP_VERIFY_TOKEN_MIN_LENGTH} characters long.`,
    );
  }
  if (issues.length > 0) throw new EnvValidationError(issues);
  return { verifyToken };
}

/**
 * Token de acceso a la Cloud API de Meta con el que se envían los mensajes
 * (`Authorization: Bearer`, DEC-040 §5). Server-only: nunca lleva prefijo
 * NEXT_PUBLIC_ ni se registra.
 */
export function parseWhatsAppApiEnv(source: EnvSource): WhatsAppApiEnv {
  const issues: string[] = [];
  const apiToken = readRequired(source, "WHATSAPP_API_TOKEN", issues);
  if (apiToken !== "" && apiToken.length < WHATSAPP_API_TOKEN_MIN_LENGTH) {
    issues.push(
      `WHATSAPP_API_TOKEN must be at least ${WHATSAPP_API_TOKEN_MIN_LENGTH} characters long.`,
    );
  }
  if (issues.length > 0) throw new EnvValidationError(issues);
  return { apiToken };
}
