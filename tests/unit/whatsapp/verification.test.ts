import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/webhooks/whatsapp/route";
import { handleWhatsAppVerification } from "@/lib/whatsapp/verification";

/*
 * GET /api/webhooks/whatsapp (DEC-039 §1): verificación de la suscripción.
 * Sin base de datos: el handler no la toca.
 */

vi.mock("server-only", () => ({}));

const TOKEN = "token-de-verificacion-1234";
const URL_BASE = "https://porandu.test/api/webhooks/whatsapp";

function get(query: Record<string, string>): Request {
  return new Request(`${URL_BASE}?${new URLSearchParams(query)}`);
}

const VALID = {
  "hub.mode": "subscribe",
  "hub.verify_token": TOKEN,
  "hub.challenge": "1158201444",
};

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", TOKEN);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handleWhatsAppVerification: éxito", () => {
  it("devuelve hub.challenge como texto plano con 200", async () => {
    const response = handleWhatsAppVerification(get(VALID));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("devuelve el challenge tal cual, sin transformarlo", async () => {
    const challenge = "abc-123_XYZ.456";
    const response = handleWhatsAppVerification(
      get({ ...VALID, "hub.challenge": challenge }),
    );
    expect(await response.text()).toBe(challenge);
  });
});

describe("handleWhatsAppVerification: rechazo 403", () => {
  it.each([
    ["token incorrecto", { "hub.verify_token": "otro-token-incorrecto" }],
    ["token con el mismo prefijo", { "hub.verify_token": TOKEN.slice(0, -1) }],
    ["token con un carácter de más", { "hub.verify_token": `${TOKEN}x` }],
    ["token en mayúsculas", { "hub.verify_token": TOKEN.toUpperCase() }],
    ["token vacío", { "hub.verify_token": "" }],
    ["modo distinto de subscribe", { "hub.mode": "unsubscribe" }],
    ["modo vacío", { "hub.mode": "" }],
    ["challenge vacío", { "hub.challenge": "" }],
    ["challenge con HTML", { "hub.challenge": "<script>1</script>" }],
    ["challenge demasiado largo", { "hub.challenge": "1".repeat(257) }],
  ])("%s", async (_, overrides) => {
    const response = handleWhatsAppVerification(
      get({ ...VALID, ...overrides }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("forbidden");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each(["hub.mode", "hub.verify_token", "hub.challenge"])(
    "falta %s",
    async (key) => {
      const { [key]: _omitted, ...rest } = VALID as Record<string, string>;
      const response = handleWhatsAppVerification(get(rest));
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("forbidden");
    },
  );

  it("sin query params", () => {
    expect(handleWhatsAppVerification(new Request(URL_BASE)).status).toBe(403);
  });

  it("el rechazo no revela el token ni el challenge", async () => {
    const response = handleWhatsAppVerification(
      get({ ...VALID, "hub.verify_token": "incorrecto-incorrecto" }),
    );
    const body = await response.text();
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain(VALID["hub.challenge"]);
  });
});

describe("handleWhatsAppVerification: token sin configurar", () => {
  it.each([
    ["sin la variable", ""],
    ["con un token de menos de 16 caracteres", "corto"],
  ])(
    "%s falla cerrado con 503, aunque el pedido coincida",
    async (_, token) => {
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", token);
      const response = handleWhatsAppVerification(
        get({ ...VALID, "hub.verify_token": token }),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("not configured");
    },
  );

  it("no usa WHATSAPP_APP_SECRET como token", () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    vi.stubEnv("WHATSAPP_APP_SECRET", TOKEN);
    expect(handleWhatsAppVerification(get(VALID)).status).toBe(503);
  });
});

describe("handleWhatsAppVerification: logs", () => {
  it("no registra el token ni el challenge", () => {
    handleWhatsAppVerification(
      get({ ...VALID, "hub.verify_token": "x".repeat(20) }),
    );
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    handleWhatsAppVerification(get(VALID));
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(VALID["hub.challenge"]);
  });
});

describe("route handler (app/api/webhooks/whatsapp)", () => {
  it("GET delega en la verificación", async () => {
    const response = route.GET(get(VALID));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
    expect(route.GET(get({ ...VALID, "hub.mode": "x" })).status).toBe(403);
  });
});
