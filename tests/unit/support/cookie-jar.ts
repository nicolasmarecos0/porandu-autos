import {
  RequestCookies,
  ResponseCookies,
} from "next/dist/server/web/spec-extension/cookies";

/*
 * Cookies de una request, con la implementación real de Next (la que usa
 * `cookies()` de next/headers): las cookies entrantes se leen de la request
 * y las escritas quedan como cabeceras Set-Cookie serializadas, para
 * verificar sus atributos.
 */
export function cookieJar(incoming: Record<string, string> = {}) {
  const request = new RequestCookies(
    new Headers({
      cookie: Object.entries(incoming)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    }),
  );
  const responseHeaders = new Headers();
  const response = new ResponseCookies(responseHeaders);

  const store = {
    get(name: string) {
      return response.get(name) ?? request.get(name);
    },
    getAll() {
      return [...request.getAll(), ...response.getAll()];
    },
    has(name: string) {
      return response.has(name) || request.has(name);
    },
    set(...args: Parameters<ResponseCookies["set"]>) {
      response.set(...args);
      return store;
    },
    delete(...args: Parameters<ResponseCookies["delete"]>) {
      response.delete(...args);
      return store;
    },
  };

  return {
    store,
    /** Cabeceras Set-Cookie que recibiría el navegador. */
    setCookies: () => responseHeaders.getSetCookie(),
  };
}

export type CookieJar = ReturnType<typeof cookieJar>;
