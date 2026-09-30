/*
 * Identidad verificada (H0.6).
 *
 * Módulo puro: no importa Supabase, Next, React ni db/. Recibe los claims que
 * devuelve `auth.getClaims()` de Supabase Auth, que ya verificó firma (contra
 * el JWKS del proyecto) y expiración del access token, y los reduce a la
 * identidad que usa el resto de la aplicación. Ante cualquier forma
 * inesperada devuelve null: falla cerrado.
 *
 * Solo pasan los claims obligatorios de un access token de Supabase (sub,
 * role, aud, iss, iat, exp, aal, session_id). Se descartan email, phone,
 * app_metadata, user_metadata (editable por el propio usuario), amr y
 * cualquier claim custom. Una organización nunca sale de los claims: la
 * organización activa la resuelve Tenant Resolution (H0.7, `requireTenant()`)
 * contra las memberships activas del usuario.
 */

/**
 * Claims de un access token verificado por Supabase Auth. Es lo que
 * withUser()/withTenant() (db/tenant.ts) fijan como `request.jwt.claims`.
 */
export type VerifiedClaims = Readonly<
  Record<string, unknown> & { sub: string; role: "authenticated" }
>;

/**
 * Usuario autenticado: identidad verificada, sin organización. Tiene la forma
 * de `UserContext` (db/tenant.ts); el contexto de tenant lo construye H0.7.
 */
export type AuthenticatedUser = Readonly<{
  userId: string;
  claims: VerifiedClaims;
}>;

/** Lo único que este módulo necesita del cliente de Supabase Auth. */
export type ClaimsVerifier = {
  getClaims(): Promise<{ data: { claims: unknown } | null; error: unknown }>;
};

// auth.users.id (y por lo tanto profiles.id) es un UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isAudience(value: unknown): value is string | string[] {
  return (
    isNonEmptyString(value) ||
    (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString))
  );
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Valida y reduce claims ya verificados por Supabase Auth. No verifica firmas:
 * nunca debe recibir claims decodificados sin verificar.
 */
export function parseVerifiedClaims(raw: unknown): VerifiedClaims | null {
  if (!isRecord(raw)) return null;

  const { sub, role, aud, iss, iat, exp, aal, session_id } = raw;
  if (typeof sub !== "string" || !UUID.test(sub)) return null;
  if (role !== "authenticated") return null;
  // Un usuario anónimo de Supabase también recibe el rol authenticated. B1
  // solo admite email + password (DEC-012).
  if (raw.is_anonymous === true) return null;
  if (
    !isAudience(aud) ||
    !isNonEmptyString(iss) ||
    !isTimestamp(iat) ||
    !isTimestamp(exp) ||
    !isNonEmptyString(aal) ||
    !isNonEmptyString(session_id)
  ) {
    return null;
  }

  return {
    sub,
    role,
    aud: Array.isArray(aud) ? [...aud] : aud,
    iss,
    iat,
    exp,
    aal,
    session_id,
  };
}

/** Identidad a partir de claims verificados; `userId` sale siempre de `sub`. */
export function toAuthenticatedUser(raw: unknown): AuthenticatedUser | null {
  const claims = parseVerifiedClaims(raw);
  return claims ? { userId: claims.sub, claims } : null;
}

/**
 * Identidad de la request según `auth.getClaims()`. Un error, una respuesta
 * vacía o una excepción equivalen a "sin usuario".
 */
export async function verifyAuthenticatedUser(
  auth: ClaimsVerifier,
): Promise<AuthenticatedUser | null> {
  try {
    const { data, error } = await auth.getClaims();
    if (error || !data) return null;
    return toAuthenticatedUser(data.claims);
  } catch {
    return null;
  }
}
