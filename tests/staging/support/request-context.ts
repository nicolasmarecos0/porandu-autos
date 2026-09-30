import type { Browser } from "./browser";

/*
 * Estado de la "request" en curso para los mocks de next/headers y
 * next/navigation del acceptance Auth → Tenant. Los factories de vi.mock lo
 * importan dinámicamente: comparten esta instancia con el spec.
 */

export class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect(${path})`);
    this.name = "RedirectSignal";
  }
}

let current: Browser | null = null;

export function setCurrentBrowser(browser: Browser | null): void {
  current = browser;
}

/** `cookies()` de next/headers. */
export async function cookies() {
  if (!current) throw new Error("no request in progress");
  return current.store();
}

/** `redirect()` de next/navigation: corta la ejecución como en Next. */
export function redirect(path: string): never {
  throw new RedirectSignal(path);
}
