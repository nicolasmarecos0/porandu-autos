import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/messages/send/route";
import type {
  OutboundMessageOutcome,
  OutboundMessageWrite,
  SendTarget,
} from "@/db/queries/outbound-message";
import type { TenantContext } from "@/db/tenant";
import {
  handleSendMessage,
  MAX_SEND_BODY_BYTES,
} from "@/lib/conversations/send";
import type { RequestTenant } from "@/lib/tenant/session";
import type {
  WhatsAppSendResult,
  WhatsAppTextMessage,
} from "@/lib/whatsapp/api";

/*
 * POST /api/messages/send (Hito 8, DEC-040) sin base de datos ni Meta:
 * defensas de la request, tenant, configuración, validación, el orden
 * lectura → Meta → registro y lo que se registra en los logs, con las
 * queries y el cliente de Meta simulados. Contra PostgreSQL 17 (aislamiento
 * de tenant, registro y endpoint de punta a punta):
 * tests/db/whatsapp-outbound.test.ts. Valores ficticios.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestTenant: vi.fn<() => Promise<unknown>>(),
  selectSendTarget:
    vi.fn<(ctx: unknown, conversationId: string) => Promise<unknown>>(),
  recordOutboundMessage:
    vi.fn<(ctx: unknown, message: unknown) => Promise<unknown>>(),
  sendWhatsAppText:
    vi.fn<(message: unknown, options: unknown) => Promise<unknown>>(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  resolveRequestTenant: mocks.resolveRequestTenant,
}));
vi.mock("@/db/queries/outbound-message", () => ({
  selectSendTarget: mocks.selectSendTarget,
  recordOutboundMessage: mocks.recordOutboundMessage,
}));
vi.mock("@/lib/whatsapp/api", () => ({
  sendWhatsAppText: mocks.sendWhatsAppText,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const TOKEN = "token-ficticio-de-la-cloud-api-0123456789";
const HOST = "app.porandu.test";
const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000c";
const CONVERSATION = "00000000-0000-4000-8000-0000000000c2";
const OPPORTUNITY = "00000000-0000-4000-8000-0000000000c4";
const MESSAGE_ID = "00000000-0000-4000-8000-0000000000c3";
const LINE = "100000000000001";
const TO = "595981555214";
const WAMID = "wamid.HBgMNTk1OTgxNTU1MjE0";

// Las queries están simuladas: el contexto solo viaja.
const ctx = {
  userId: USER,
  organizationId: ORG,
  role: "seller",
  claims: { sub: USER, role: "authenticated" },
} as unknown as TenantContext;

const ready: SendTarget = { outcome: "ready", phoneNumberId: LINE, to: TO };
const recorded: OutboundMessageOutcome = {
  outcome: "recorded",
  messageId: MESSAGE_ID,
  opportunityId: null,
};

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("WHATSAPP_API_TOKEN", TOKEN);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveRequestTenant.mockResolvedValue({
    kind: "resolved",
    context: ctx,
  } satisfies RequestTenant);
  mocks.selectSendTarget.mockResolvedValue(ready);
  mocks.sendWhatsAppText.mockResolvedValue({
    ok: true,
    messageId: WAMID,
  } satisfies WhatsAppSendResult);
  mocks.recordOutboundMessage.mockResolvedValue(recorded);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(
  body: unknown = { conversationId: CONVERSATION, text: "Hola" },
  headers: Record<string, string | null> = {},
): Request {
  const all: Record<string, string | null> = {
    origin: `https://${HOST}`,
    "x-forwarded-host": HOST,
    "content-type": "application/json",
    ...headers,
  };
  return new Request(`https://${HOST}/api/messages/send`, {
    method: "POST",
    headers: Object.fromEntries(
      Object.entries(all).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    ),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function send(req: Request = request()) {
  const response = await handleSendMessage(req);
  return { status: response.status, body: await response.json() };
}

function nothingHappened(): void {
  expect(mocks.selectSendTarget).not.toHaveBeenCalled();
  expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  expect(mocks.recordOutboundMessage).not.toHaveBeenCalled();
}

describe("ruta", () => {
  it("solo exporta POST, en runtime Node, y delega en handleSendMessage()", async () => {
    expect(route.runtime).toBe("nodejs");
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    const response = await route.POST(request());
    expect(response.status).toBe(200);
  });
});

describe("defensas de la request (DEC-040 §2)", () => {
  it.each([
    ["sin Origin", { origin: null }],
    ["con Origin de otro host", { origin: "https://evil.example" }],
    ["con Origin null", { origin: "null" }],
    ["con Origin de otro puerto", { origin: `https://${HOST}:8443` }],
    ["sin host", { "x-forwarded-host": null }],
  ])("%s: 403 sin resolver el tenant", async (_, headers) => {
    expect(await send(request(undefined, headers))).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(mocks.resolveRequestTenant).not.toHaveBeenCalled();
    nothingHappened();
  });

  it("toma el primer host de x-forwarded-host", async () => {
    expect(
      (await send(request(undefined, { "x-forwarded-host": `${HOST}, otro` })))
        .status,
    ).toBe(200);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["un formulario", "application/x-www-form-urlencoded"],
    ["sin Content-Type", null],
  ])("con %s: 415", async (_, type) => {
    expect(
      await send(request(undefined, { "content-type": type })),
    ).toMatchObject({ status: 415, body: { error: "unsupported_media_type" } });
    nothingHappened();
  });

  it("acepta application/json con charset", async () => {
    expect(
      (
        await send(
          request(undefined, {
            "content-type": "application/json; charset=utf-8",
          }),
        )
      ).status,
    ).toBe(200);
  });
});

describe("autorización (DEC-040 §3)", () => {
  it("sin usuario verificado: 401", async () => {
    mocks.resolveRequestTenant.mockResolvedValue({ kind: "unauthenticated" });
    expect(await send()).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
    nothingHappened();
  });

  it.each(["no-access", "select-organization"])(
    "sin organización activa resuelta (%s): 403",
    async (kind) => {
      mocks.resolveRequestTenant.mockResolvedValue({ kind });
      expect(await send()).toEqual({
        status: 403,
        body: { error: "forbidden" },
      });
      nothingHappened();
    },
  );

  it("la organización sale del contexto: una del pedido se ignora", async () => {
    await send(
      request({
        conversationId: CONVERSATION,
        text: "Hola",
        organizationId: "00000000-0000-4000-8000-000000000002",
      }),
    );
    expect(mocks.selectSendTarget).toHaveBeenCalledWith(ctx, CONVERSATION);
    expect(mocks.recordOutboundMessage.mock.calls[0]?.[0]).toBe(ctx);
  });
});

describe("configuración y cuerpo", () => {
  it("sin WHATSAPP_API_TOKEN: 503 sin leer la base ni llamar a Meta", async () => {
    vi.stubEnv("WHATSAPP_API_TOKEN", "");
    expect(await send()).toEqual({
      status: 503,
      body: { error: "not_configured" },
    });
    nothingHappened();
  });

  it("un cuerpo de más de 64 KiB: 413", async () => {
    const big = "a".repeat(MAX_SEND_BODY_BYTES);
    expect(
      await send(request({ conversationId: CONVERSATION, text: big })),
    ).toEqual({ status: 413, body: { error: "payload_too_large" } });
    expect(
      await send(
        request(undefined, {
          "content-length": String(MAX_SEND_BODY_BYTES + 1),
        }),
      ),
    ).toEqual({ status: 413, body: { error: "payload_too_large" } });
    nothingHappened();
  });

  it.each([
    ["JSON inválido", "{", { conversationId: "required", text: "required" }],
    [
      "un id que no es UUID",
      { conversationId: "1", text: "Hola" },
      { conversationId: "invalid" },
    ],
    [
      "un texto vacío",
      { conversationId: CONVERSATION, text: "  " },
      { text: "empty" },
    ],
    [
      "un texto de más de 4096",
      { conversationId: CONVERSATION, text: "a".repeat(4097) },
      { text: "too_long" },
    ],
  ])("%s: 400 con el error de cada campo", async (_, body, fieldErrors) => {
    expect(await send(request(body))).toEqual({
      status: 400,
      body: { error: "invalid", errors: fieldErrors },
    });
    nothingHappened();
  });
});

describe("destino (DEC-040 §4)", () => {
  it.each([
    ["not_found", 404],
    ["no_line", 409],
    ["no_recipient", 409],
  ] as const)("%s: %i sin llamar a Meta", async (outcome, status) => {
    mocks.selectSendTarget.mockResolvedValue({ outcome });
    expect(await send()).toEqual({ status, body: { error: outcome } });
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.recordOutboundMessage).not.toHaveBeenCalled();
  });

  it("si la lectura falla: 500 failed, sin llamar a Meta y sin detalles", async () => {
    mocks.selectSendTarget.mockRejectedValue(
      Object.assign(new Error(`select ... ${TO}`), {
        cause: { code: "08006", constraint_name: undefined },
      }),
    );
    expect(await send()).toEqual({ status: 500, body: { error: "failed" } });
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TO);
  });
});

describe("Meta (DEC-040 §5)", () => {
  it("envía el texto normalizado desde la línea al destinatario, con el token", async () => {
    await send(
      request({
        conversationId: CONVERSATION.toUpperCase(),
        text: "  Hola  vos ",
      }),
    );
    expect(mocks.selectSendTarget).toHaveBeenCalledWith(ctx, CONVERSATION);
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith(
      {
        phoneNumberId: LINE,
        to: TO,
        body: "Hola vos",
      } satisfies WhatsAppTextMessage,
      { token: TOKEN },
    );
  });

  it("si el cliente de Meta lanza antes de enviar (destino mal formado): 500 failed, sin registrar", async () => {
    mocks.sendWhatsAppText.mockRejectedValue(
      new TypeError("invalid WhatsApp text message"),
    );
    expect(await send()).toEqual({ status: 500, body: { error: "failed" } });
    expect(mocks.recordOutboundMessage).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[conversations] send message send failed",
      { name: "TypeError", code: undefined, constraint_name: undefined },
    );
  });

  it.each([
    ["rejected", "provider_rejected"],
    ["unavailable", "provider_unavailable"],
  ] as const)("%s: 502 %s, sin registrar nada", async (failure, error) => {
    mocks.sendWhatsAppText.mockResolvedValue({
      ok: false,
      failure,
      status: failure === "rejected" ? 400 : 503,
      code: 131030,
    });
    expect(await send()).toEqual({ status: 502, body: { error } });
    expect(mocks.recordOutboundMessage).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[conversations] WhatsApp send failed",
      {
        failure,
        status: failure === "rejected" ? 400 : 503,
        code: 131030,
      },
    );
  });
});

describe("registro (DEC-040 §6 y §8)", () => {
  it("registra lo que Meta aceptó: su id, el texto enviado y su preview", async () => {
    const text = `Hola\n${"a".repeat(200)}`;
    await send(request({ conversationId: CONVERSATION, text }));
    const [, message] = mocks.recordOutboundMessage.mock.calls[0]!;
    expect(message).toEqual({
      conversationId: CONVERSATION,
      externalId: WAMID,
      content: text,
      preview: `Hola ${"a".repeat(154)}…`,
    } satisfies OutboundMessageWrite);
    // Primero Meta, después el registro.
    expect(mocks.sendWhatsAppText.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordOutboundMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("200 con el id del mensaje y revalida la bandeja", async () => {
    expect(await send()).toEqual({
      status: 200,
      body: { outcome: "sent", messageId: MESSAGE_ID },
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([["/conversations"]]);
  });

  it("con oportunidad, revalida también la cola y su detalle", async () => {
    mocks.recordOutboundMessage.mockResolvedValue({
      ...recorded,
      opportunityId: OPPORTUNITY,
    });
    await send();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/conversations"],
      ["/opportunities"],
      [`/opportunities/${OPPORTUNITY}`],
    ]);
  });

  it("un duplicate (el mismo id de Meta ya registrado) también es 200", async () => {
    mocks.recordOutboundMessage.mockResolvedValue({
      ...recorded,
      outcome: "duplicate",
    });
    expect((await send()).status).toBe(200);
  });

  it("si Meta aceptó y el registro falla: 500 unrecorded, con solo el tipo, el SQLSTATE y la constraint en el log", async () => {
    mocks.recordOutboundMessage.mockRejectedValue(
      Object.assign(new Error(`insert ... Hola ${TOKEN}`), {
        cause: { code: "42501", constraint_name: undefined },
      }),
    );
    expect(await send()).toEqual({
      status: 500,
      body: { error: "unrecorded" },
    });
    expect(errors).toHaveBeenCalledWith(
      "[conversations] send message record failed",
      { name: "Error", code: "42501", constraint_name: undefined },
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("si la conversación ya no está abierta al registrar: 500 unrecorded", async () => {
    mocks.recordOutboundMessage.mockResolvedValue({ outcome: "not_found" });
    expect(await send()).toEqual({
      status: 500,
      body: { error: "unrecorded" },
    });
  });

  it("ningún log lleva el token, el texto, el teléfono ni ids", async () => {
    mocks.sendWhatsAppText.mockResolvedValue({
      ok: false,
      failure: "rejected",
      status: 400,
      code: 100,
    });
    await send(
      request({ conversationId: CONVERSATION, text: "Texto privado" }),
    );
    vi.stubEnv("WHATSAPP_API_TOKEN", "");
    await send(
      request({ conversationId: CONVERSATION, text: "Texto privado" }),
    );
    const logged = JSON.stringify(errors.mock.calls);
    for (const secret of [TOKEN, "Texto privado", TO, LINE, CONVERSATION]) {
      expect(logged).not.toContain(secret);
    }
  });
});
