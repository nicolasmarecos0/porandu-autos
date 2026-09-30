/*
 * Login con email + password (DEC-012): validación del formulario y
 * clasificación de errores. Módulo puro, sin Supabase ni Next.
 *
 * Ningún error revela si una cuenta existe: credenciales incorrectas, email
 * sin confirmar, usuario bloqueado o inexistente son el mismo
 * `invalid_credentials`. El password nunca vuelve al cliente.
 */

export type LoginError =
  | "missing_fields"
  | "invalid_email"
  | "invalid_credentials"
  | "rate_limited"
  | "unavailable";

/** Estado del formulario. El email vuelve para no tener que reescribirlo. */
export type LoginFormState = Readonly<{
  error: LoginError;
  email: string;
}> | null;

export type LoginInput = Readonly<{ email: string; password: string }>;

type ParsedLoginForm =
  | { ok: true; input: LoginInput }
  | { ok: false; error: LoginError; email: string };

const MAX_EMAIL_LENGTH = 254;
// Cota de tamaño, no una política de passwords (la define Supabase Auth).
const MAX_PASSWORD_LENGTH = 1024;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** Solo lee `email` y `password`; cualquier otro campo se ignora. */
export function parseLoginForm(formData: FormData): ParsedLoginForm {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  // El password no se normaliza: se envía tal cual.
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const echo = email.slice(0, MAX_EMAIL_LENGTH);

  if (email === "" || password === "") {
    return { ok: false, error: "missing_fields", email: echo };
  }
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return { ok: false, error: "invalid_email", email: echo };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "invalid_credentials", email: echo };
  }
  return { ok: true, input: { email, password } };
}

function statusOf(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return null;
}

/**
 * Clasifica un error de `signInWithPassword` por su status HTTP. Todo 4xx
 * (salvo 429) es `invalid_credentials`; la red caída, un 5xx o un error sin
 * status son `unavailable`.
 */
export function loginErrorFrom(error: unknown): LoginError {
  const status = statusOf(error);
  if (status === 429) return "rate_limited";
  if (status !== null && status >= 400 && status < 500) {
    return "invalid_credentials";
  }
  return "unavailable";
}
