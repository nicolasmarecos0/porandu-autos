/*
 * Indicador "Conexión segura verificada" del login (DEC-057). Solo se
 * muestra si la request llegó por HTTPS: en Vercel la plataforma fija
 * `x-forwarded-proto`; en `next dev` (http://localhost) no es https y el
 * indicador no aparece. Es un dato de presentación: no autoriza nada.
 *
 * Detrás de varios proxies el header puede traer una lista
 * ("https, http"): vale el primero, el del cliente.
 */
export function isSecureRequest(headers: Pick<Headers, "get">): boolean {
  const forwarded = headers.get("x-forwarded-proto");
  if (!forwarded) return false;
  return forwarded.split(",")[0]?.trim().toLowerCase() === "https";
}
