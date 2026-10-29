import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRAPH_API_VERSION,
  messagesEndpoint,
  sendWhatsAppText,
  type WhatsAppTextMessage,
} from "@/lib/whatsapp/api";

/*
 * Cliente de envío de la Cloud API de Meta (Hito 8, DEC-040 §5) con fetch
 * simulado: la request que sale y cómo se lee cada respuesta. Valores
 * ficticios.
 */

vi.mock("server-only", () => ({}));

const TOKEN = "token-ficticio-de-la-cloud-api-0123456789";
const MESSAGE: WhatsAppTextMessage = {
  phoneNumberId: "100000000000001",
  to: "595981555214",
  body: "Hola, ¿seguís interesado en la Hilux?",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function send(message: WhatsAppTextMessage = MESSAGE, timeoutMs?: number) {
  return sendWhatsAppText(message, {
    token: TOKEN,
    fetch: fetchMock,
    timeoutMs,
  });
}

describe("la request a Meta", () => {
  it("POST al endpoint v20.0 de la línea, con el token como Bearer y un mensaje de texto", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ messages: [{ id: "wamid.ABC" }] }, { status: 200 }),
    );

    await send();

    expect(GRAPH_API_VERSION).toBe("v20.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://graph.facebook.com/v20.0/100000000000001/messages",
    );
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "595981555214",
      type: "text",
      text: { preview_url: false, body: MESSAGE.body },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("messagesEndpoint arma la URL de la línea", () => {
    expect(messagesEndpoint("123")).toBe(
      "https://graph.facebook.com/v20.0/123/messages",
    );
  });

  it.each([
    ["una línea que no es solo dígitos", { phoneNumberId: "../me" }],
    ["un destinatario con +", { to: "+595981555214" }],
    ["un destinatario con 0 inicial", { to: "0981555214" }],
    ["un texto vacío", { body: "  " }],
  ])("lanza ante %s, sin llamar a Meta", async (_, overrides) => {
    await expect(send({ ...MESSAGE, ...overrides })).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lanza sin token, sin llamar a Meta", async () => {
    await expect(
      sendWhatsAppText(MESSAGE, { token: "", fetch: fetchMock }),
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("la respuesta de Meta", () => {
  it("200 con el id del mensaje: ok con el wamid, tolerante a campos nuevos", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          messaging_product: "whatsapp",
          contacts: [{ input: "595981555214", wa_id: "595981555214" }],
          messages: [
            { id: "wamid.HBgMNTk1OTgxNTU1MjE0", message_status: "accepted" },
          ],
          nuevo_campo: true,
        },
        { status: 200 },
      ),
    );
    expect(await send()).toEqual({
      ok: true,
      messageId: "wamid.HBgMNTk1OTgxNTU1MjE0",
    });
  });

  it.each([
    ["sin messages", {}],
    ["messages vacío", { messages: [] }],
    ["un id vacío", { messages: [{ id: "" }] }],
    ["un id con espacios", { messages: [{ id: "wamid. X" }] }],
    ["un id que no es texto", { messages: [{ id: 7 }] }],
  ])("200 %s: unavailable (no se puede registrar sin id)", async (_, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status: 200 }));
    expect(await send()).toEqual({
      ok: false,
      failure: "unavailable",
      status: 200,
      code: null,
    });
  });

  it("200 con un cuerpo que no es JSON: unavailable", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await send()).toMatchObject({ ok: false, failure: "unavailable" });
  });

  it("solo 200 es éxito: otro 2xx es unavailable", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ messages: [{ id: "wamid.ABC" }] }, { status: 201 }),
    );
    expect(await send()).toEqual({
      ok: false,
      failure: "unavailable",
      status: 201,
      code: null,
    });
  });

  it.each([400, 401, 403, 404, 429])(
    "%i: rejected, con el código de error de Meta",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json(
          {
            error: {
              message: "(#131030) Recipient phone number not in allowed list",
              type: "OAuthException",
              code: 131030,
              fbtrace_id: "x",
            },
          },
          { status },
        ),
      );
      expect(await send()).toEqual({
        ok: false,
        failure: "rejected",
        status,
        code: 131030,
      });
    },
  );

  it("un 4xx sin cuerpo de error: rejected sin código", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 400 }));
    expect(await send()).toEqual({
      ok: false,
      failure: "rejected",
      status: 400,
      code: null,
    });
  });

  it.each([500, 502, 503])("%i: unavailable", async (status) => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: 2 } }, { status }),
    );
    expect(await send()).toEqual({
      ok: false,
      failure: "unavailable",
      status,
      code: 2,
    });
  });

  it("un error de red: unavailable sin status", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await send()).toEqual({
      ok: false,
      failure: "unavailable",
      status: null,
      code: null,
    });
  });

  it("el timeout aborta la request: unavailable", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    expect(await send(MESSAGE, 10)).toEqual({
      ok: false,
      failure: "unavailable",
      status: null,
      code: null,
    });
  });

  it("el resultado nunca lleva el token, el destinatario ni el texto", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 100, message: `${TOKEN} ${MESSAGE.to}` } },
        { status: 400 },
      ),
    );
    const result = JSON.stringify(await send());
    expect(result).not.toContain(TOKEN);
    expect(result).not.toContain(MESSAGE.to);
    expect(result).not.toContain(MESSAGE.body);
  });
});
