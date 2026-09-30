import { cookieJar, type CookieJar } from "../../unit/support/cookie-jar";

/*
 * Navegador mínimo para ejercitar Server Actions y requireTenant() fuera de
 * Next: guarda las cookies entre requests y aplica los Set-Cookie de cada
 * respuesta (incluidos los borrados), con la implementación real de cookies
 * de Next (tests/unit/support/cookie-jar.ts).
 */
export class Browser {
  private readonly cookies = new Map<string, string>();
  private jar: CookieJar | null = null;

  /** Nueva request con las cookies actuales. */
  request(): CookieJar {
    this.jar = cookieJar(Object.fromEntries(this.cookies));
    return this.jar;
  }

  /** Lo que ve `cookies()` de next/headers en la request actual. */
  store(): CookieJar["store"] {
    if (!this.jar) throw new Error("no request in progress");
    return this.jar.store;
  }

  /** Aplica los Set-Cookie de la respuesta y cierra la request. */
  respond(): void {
    if (!this.jar) return;
    for (const header of this.jar.setCookies()) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = decodeURIComponent(pair.slice(0, separator).trim());
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      const expired = attributes.some((attribute) => {
        const [key = "", raw = ""] = attribute.trim().split("=");
        if (key.toLowerCase() === "max-age") return Number(raw) <= 0;
        if (key.toLowerCase() === "expires") {
          return new Date(raw).getTime() <= Date.now();
        }
        return false;
      });
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.jar = null;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  names(): string[] {
    return [...this.cookies.keys()].sort();
  }

  /** Cookie escrita "a mano" (un cliente que falsifica o altera cookies). */
  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  delete(name: string): void {
    this.cookies.delete(name);
  }
}
