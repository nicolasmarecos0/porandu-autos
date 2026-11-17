import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CORE_OUTPUTS,
  CORE_SOURCES,
  CoreDiagram,
} from "@/components/auth/core-diagram";
import {
  LOGIN_TAGLINE,
  LoginCompactIntro,
  LoginShowcase,
} from "@/components/auth/login-showcase";
import { isSecureRequest } from "@/lib/auth/secure-connection";

/*
 * /login ejecutivo (DEC-057), renderizado en el servidor sin DOM:
 * - con sesión verificada redirige a /cockpit, como antes (DEC-020);
 * - "Conexión segura verificada" solo si la request llegó por HTTPS;
 * - el formulario sigue siendo email + password (DEC-012);
 * - "El Núcleo Porandú" ilustra fuentes y salidas que el producto tiene,
 *   sin canales de omnicanalidad (non-goal) ni marcas de terceros;
 * - los íconos usan tonos AA, nunca un `*-bright` como color de texto;
 * - con reduced motion no hay movimiento: quedan puntos fijos.
 */

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  return {
    RedirectSignal,
    getAuthenticatedUser: vi.fn(),
    headers: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/actions", () => ({ signIn: vi.fn() }));

const { default: LoginPage, metadata } =
  await import("@/app/(auth)/login/page");

const USER = Object.freeze({ userId: "00000000-0000-4000-8000-00000000000a" });

function requestHeaders(values: Record<string, string>): Headers {
  return new Headers(values);
}

async function renderPage(forwardedProto?: string): Promise<string> {
  mocks.headers.mockResolvedValueOnce(
    requestHeaders(
      forwardedProto ? { "x-forwarded-proto": forwardedProto } : {},
    ),
  );
  const element = (await LoginPage()) as ReactElement;
  return renderToStaticMarkup(element);
}

/** Texto visible sin etiquetas, para buscar frases cortadas por spans. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  mocks.getAuthenticatedUser.mockReset();
  mocks.headers.mockReset();
  mocks.redirect.mockClear();
});

describe("isSecureRequest", () => {
  it.each([
    ["https", true],
    ["HTTPS", true],
    [" https ", true],
    ["https, http", true],
    ["http", false],
    ["http, https", false],
    ["", false],
  ])("x-forwarded-proto %j → %s", (value, expected) => {
    expect(
      isSecureRequest(requestHeaders({ "x-forwarded-proto": value })),
    ).toBe(expected);
  });

  it("sin el header no afirma nada", () => {
    expect(isSecureRequest(requestHeaders({}))).toBe(false);
  });
});

describe("/login", () => {
  it("con un usuario verificado redirige al inicio y no renderiza", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(USER);

    await expect(LoginPage()).rejects.toThrow("redirect(/cockpit)");
    expect(mocks.redirect).toHaveBeenCalledWith("/cockpit");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("título de la pestaña", () => {
    expect(metadata).toEqual({ title: "Iniciar sesión" });
  });

  it("tarjeta: título, subtítulo y el formulario de email + contraseña", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const html = await renderPage("https");

    expect(html).toContain('<h1 id="login-title"');
    expect(textOf(html)).toContain(
      "Iniciar sesión Ingresá a tu sala de ventas inteligente con tu email y contraseña.",
    );
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(textOf(html)).toContain("Ingresar");
    // Sin registro, magic link, OAuth ni reset de password (DEC-012/020).
    expect(textOf(html)).not.toMatch(
      /registr|olvidaste|magic|google|crear cuenta/i,
    );
  });

  it("por HTTPS muestra el indicador de conexión segura", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const html = await renderPage("https");

    expect(textOf(html)).toContain(
      "Conexión segura verificada · Porandú Autos",
    );
  });

  it.each([["http"], [undefined]])(
    "sin HTTPS (%s) no lo muestra",
    async (proto) => {
      mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

      const html = await renderPage(proto);

      expect(html).not.toContain("Conexión segura");
    },
  );

  it("el formulario va antes que la columna visual (orden del DOM y del Tab)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const html = await renderPage("https");

    expect(html.indexOf('id="email"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="email"')).toBeLessThan(html.indexOf("<aside"));
    expect(html).toContain("lg:grid-cols-[42fr_58fr]");
  });
});

describe("eslogan", () => {
  it("copy es-PY aprobado", () => {
    expect(LOGIN_TAGLINE.eyebrow).toBe("Inteligencia comercial automotriz");
    expect(LOGIN_TAGLINE.title).toBe("El núcleo: ventas sin caos.");
    expect(LOGIN_TAGLINE.values.map((value) => value.label)).toEqual([
      "4 Scores de Decisión",
      "Top Match de Stock",
      "Velocidad en Salón",
    ]);
  });

  it("columna visual solo desde lg; encabezado compacto solo debajo", () => {
    const showcase = renderToStaticMarkup(createElement(LoginShowcase));
    const compact = renderToStaticMarkup(createElement(LoginCompactIntro));

    expect(showcase).toMatch(/<aside[^>]*class="[^"]*\bhidden\b[^"]*lg:flex/);
    expect(showcase).toContain(LOGIN_TAGLINE.title);
    expect(textOf(showcase)).toContain(LOGIN_TAGLINE.body);
    expect(compact).toContain("lg:hidden");
    expect(compact).toContain(LOGIN_TAGLINE.title);
    // El teléfono no carga el diagrama ni el párrafo largo.
    expect(compact).not.toContain("Núcleo Porandú");
    expect(compact).not.toContain(LOGIN_TAGLINE.body);
  });
});

describe("El Núcleo Porandú", () => {
  const html = renderToStaticMarkup(createElement(CoreDiagram));

  it("cinco fuentes que Porandú tiene, cinco salidas para el salón", () => {
    expect(CORE_SOURCES.map((node) => node.label)).toEqual([
      "Prospectos",
      "Historial y notas",
      "Reglas del motor",
      "Stock y unidades",
      "Tendencias de demanda",
    ]);
    expect(CORE_OUTPUTS.map((node) => node.label)).toEqual([
      "Porandú Score y prioridad",
      "Contacto en el salón",
      "Señales fuertes de compra",
      "Cotización en PDF",
      "Cierre y match de unidad",
    ]);
    for (const { label } of [...CORE_SOURCES, ...CORE_OUTPUTS]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-label="Fuentes de Porandú"');
    expect(html).toContain('aria-label="Inteligencia para el salón"');
    expect(html).toContain("Núcleo Porandú");
  });

  it("sin canales de omnicanalidad ni marcas de terceros", () => {
    const showcase = textOf(renderToStaticMarkup(createElement(LoginShowcase)));
    expect(showcase).not.toMatch(
      /instagram|facebook|google|\bads\b|meta|tiktok|email|correo|sms|campañ/i,
    );
  });

  it("íconos y textos en tonos AA: ningún *-bright como color de texto", () => {
    const showcase = renderToStaticMarkup(createElement(LoginShowcase));
    expect(showcase).not.toMatch(/\btext-[a-z-]*bright\b/);
    expect(showcase).not.toMatch(/\btext-accent\b(?!-)/);
    // El naranja de la referencia queda en su variante AA para el ícono.
    expect(html).toContain("text-accent-strong");
  });

  it("diez curvas punteadas: cinco entran al núcleo y cinco salen", () => {
    const dashed =
      /<g class="stroke-navy\/30"[^>]*stroke-dasharray="4 5"[^>]*>(.*?)<\/g>/.exec(
        html,
      );
    expect(dashed).not.toBeNull();
    expect(dashed![1]!.match(/<path /g)).toHaveLength(10);
  });

  it("datos en tránsito con SMIL, ocultos con reduced motion", () => {
    expect(html.match(/<animateMotion /g)).toHaveLength(5);
    expect(html).toContain('repeatCount="indefinite"');
    // Las tres tonalidades del pedido: azul acero, celeste y el pulso naranja.
    expect(html).toContain("fill-brand");
    expect(html).toContain("fill-info-bright");
    expect(html).toContain("fill-accent");
    expect(html).toMatch(
      /<g class="motion-reduce:hidden">(?:(?!<\/svg>).)*<animateMotion/,
    );
  });

  it("con reduced motion, los mismos cinco datos quietos sobre sus curvas", () => {
    const still =
      /<g class="hidden motion-reduce:inline">(.*?)<\/g><\/svg>/.exec(html);
    expect(still).not.toBeNull();
    expect(still![1]).not.toContain("animate");
    // Cada dato es un halo translúcido y un punto: sin blur ni neón (DEC-013).
    expect(still![1]!.match(/<circle /g)).toHaveLength(10);
    expect(html).not.toMatch(/feGaussianBlur|drop-shadow|blur/);
  });

  it("el pulso del núcleo también se apaga con reduced motion", () => {
    expect(html).toMatch(/animate-core-pulse[^"]*motion-reduce:hidden/);
  });
});
