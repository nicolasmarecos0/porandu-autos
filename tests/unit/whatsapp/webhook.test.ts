import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/webhooks/whatsapp/route";
import type {
  InboundMessageOutcome,
  InboundMessageWrite,
} from "@/db/queries/ingest-whatsapp-message";
import type {
  DeliveryStatusOutcome,
  DeliveryStatusWrite,
} from "@/db/queries/ingest-whatsapp-status";
import {
  handleWhatsAppWebhook,
  MAX_WEBHOOK_BODY_BYTES,
} from "@/lib/whatsapp/webhook";

import {
  messagesValue,
  rawStatus,
  rawText,
  signature,
  signedRequest,
  statusWebhook,
  TEST_APP_SECRET,
  TEST_LINE_ID,
  textMessage,
  textWebhook,
  webhook,
} from "../support/whatsapp-payload";

/*
 * Webhook de WhatsApp (Hito 7, DEC-039; Hito 12C, DEC-044 §3.3) sin base de
 * datos: secreto, cota del cuerpo, firma, validación y lo que se le pide a
 * la ingesta de mensajes y de estados de entrega, con las escrituras
 * simuladas. Las ingestas reales contra PostgreSQL 17 están en
 * tests/db/whatsapp-ingestion.test.ts y tests/db/whatsapp-statuses.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  ingest: vi.fn<(message: unknown) => Promise<unknown>>(),
  ingestStatus: vi.fn<(status: unknown) => Promise<unknown>>(),
}));

vi.mock("@/db/queries/ingest-whatsapp-message", () => ({
  ingestInboundMessage: mocks.ingest,
}));
vi.mock("@/db/queries/ingest-whatsapp-status", () => ({
  ingestDeliveryStatus: mocks.ingestStatus,
}));

const ORG = "00000000-0000-4000-8000-000000000001";

type Ingested = Extract<InboundMessageOutcome, { messageId: string }>;

function recorded(): Ingested {
  return {
    outcome: "recorded",
    organizationId: ORG,
    contactId: "00000000-0000-4000-8000-0000000000c1",
    conversationId: "00000000-0000-4000-8000-0000000000c2",
    opportunityId: null,
    messageId: "00000000-0000-4000-8000-0000000000c3",
  };
}

function calls(): InboundMessageWrite[] {
  return mocks.ingest.mock.calls.map(
    ([message]) => message as InboundMessageWrite,
  );
}

function statusRecorded(): Extract<
  DeliveryStatusOutcome,
  { messageId: string }
> {
  return {
    outcome: "recorded",
    organizationId: ORG,
    messageId: "00000000-0000-4000-8000-0000000000d1",
  };
}

function statusCalls(): DeliveryStatusWrite[] {
  return mocks.ingestStatus.mock.calls.map(
    ([status]) => status as DeliveryStatusWrite,
  );
}

/** Los conteos de los estados cuando el webhook no trae ninguno. */
const NO_STATUSES = {
  received: 0,
  recorded: 0,
  duplicate: 0,
  unknown_line: 0,
  unknown_message: 0,
  invalid: 0,
};

let errors: ReturnType<typeof vi.spyOn>;
let infos: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("WHATSAPP_APP_SECRET", TEST_APP_SECRET);
  mocks.ingest.mockReset();
  mocks.ingest.mockImplementation(async () => recorded());
  mocks.ingestStatus.mockReset();
  mocks.ingestStatus.mockImplementation(async () => statusRecorded());
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  infos = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Todo lo que se registró en los logs, como texto. */
function logged(): string {
  return JSON.stringify([...errors.mock.calls, ...infos.mock.calls]);
}

describe("secreto (DEC-039 §2)", () => {
  it.each([
    ["sin la variable", ""],
    ["con un secreto de menos de 32 caracteres", "short-secret"],
  ])("%s falla cerrado con 503 y no ingiere nada", async (_, secret) => {
    vi.stubEnv("WHATSAPP_APP_SECRET", secret);
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([textMessage()]), { secret }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(mocks.ingest).not.toHaveBeenCalled();
    if (secret !== "") expect(logged()).not.toContain(secret);
  });
});

describe("cuerpo y firma", () => {
  it("un content-length de más de 3 MiB es 413, sin leer ni ingerir", async () => {
    const request = new Request("https://porandu.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1) },
      body: "{}",
    });
    const response = await handleWhatsAppWebhook(request);
    expect(response.status).toBe(413);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("un cuerpo de más de 3 MiB es 413 aunque no declare su largo", async () => {
    const body = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    const request = new Request("https://porandu.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signature(body) },
      body,
    });
    expect((await handleWhatsAppWebhook(request)).status).toBe(413);
  });

  it("sin firma es 401 y no ingiere nada", async () => {
    const request = new Request("https://porandu.test/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(textWebhook([textMessage()])),
    });
    const response = await handleWhatsAppWebhook(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("con la firma de otro secreto es 401", async () => {
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([textMessage()]), {
        secret: "another-secret-another-secret-xx",
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("un cuerpo alterado después de firmar es 401", async () => {
    const original = JSON.stringify(textWebhook([textMessage()]));
    const tampered = original.replace(TEST_LINE_ID, "100000000000009");
    const request = new Request("https://porandu.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signature(original) },
      body: tampered,
    });
    expect((await handleWhatsAppWebhook(request)).status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});

describe("validación (DEC-039 §3)", () => {
  function signedRaw(body: string): Request {
    return new Request("https://porandu.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signature(body) },
      body,
    });
  }

  it("un cuerpo firmado que no es JSON es 400", async () => {
    const response = await handleWhatsAppWebhook(signedRaw("not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("un sobre firmado inválido es 400", async () => {
    const response = await handleWhatsAppWebhook(
      signedRequest({ object: "page", entry: [] }),
    );
    expect(response.status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});

describe("ingesta", () => {
  it("pide la ingesta de cada mensaje de texto con lo ya validado y normalizado", async () => {
    const message = textMessage({
      timestamp: 1_792_600_000,
      body: "Hola\n\n¿Sigue   disponible?",
    });
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([message])),
    );

    expect(response.status).toBe(200);
    expect(calls()).toEqual([
      {
        lineId: TEST_LINE_ID,
        externalId: message.id,
        phone: "+595981555214",
        phoneNormalized: "+595981555214",
        contactName: "Ramón Benítez",
        content: "Hola\n\n¿Sigue disponible?",
        preview: "Hola ¿Sigue disponible?",
        sentAt: new Date(1_792_600_000 * 1000),
      },
    ]);
    // La organización nunca sale del webhook: no hay campo para elegirla.
    expect(Object.keys(calls()[0]!)).not.toContain("organizationId");
  });

  it("responde 200 con los conteos de cada resultado", async () => {
    const outcomes: InboundMessageOutcome[] = [
      recorded(),
      { ...recorded(), outcome: "duplicate" },
      { outcome: "unknown_line" },
    ];
    mocks.ingest.mockImplementation(async () => outcomes.shift());
    const payload = webhook(
      messagesValue({
        messages: [textMessage(), textMessage(), textMessage()].map((m) => ({
          from: m.from,
          id: m.id,
          timestamp: String(m.timestamp),
          text: { body: m.body },
          type: "text",
        })),
        statuses: [
          rawStatus({ id: "wamid.OUT", status: "read", timestamp: 1 }),
          rawStatus({ id: "wamid.OUT", status: "deleted", timestamp: 1 }),
        ],
      }),
    );

    const response = await handleWhatsAppWebhook(signedRequest(payload));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      received: 3,
      recorded: 1,
      duplicate: 1,
      unknown_line: 1,
      invalid_sender: 0,
      invalid: 0,
      // El estado que no es del contrato.
      ignored: 1,
      // El estado con un instante inválido.
      statuses: { ...NO_STATUSES, invalid: 1 },
    });
    expect(mocks.ingestStatus).not.toHaveBeenCalled();
  });

  it("sin perfil, el contacto nuevo se llama 'Contacto de WhatsApp'", async () => {
    await handleWhatsAppWebhook(
      signedRequest(textWebhook([textMessage()], { profiles: null })),
    );
    expect(calls()[0]?.contactName).toBe("Contacto de WhatsApp");
  });

  it("un número de origen que no es un teléfono válido no se ingiere (invalid_sender)", async () => {
    // 999 no es un código de país.
    const bad = textMessage({ from: "999123456789" });
    const good = textMessage();
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([bad, good])),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: 2,
      recorded: 1,
      invalid_sender: 1,
    });
    expect(calls().map((c) => c.externalId)).toEqual([good.id]);
  });

  it("un mensaje con un campo inválido se descarta y el resto se ingiere", async () => {
    const bad = textMessage({ body: "   " });
    const good = textMessage();
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([bad, good])),
    );
    expect(await response.json()).toMatchObject({
      received: 1,
      recorded: 1,
      invalid: 1,
    });
    expect(calls().map((c) => c.externalId)).toEqual([good.id]);
  });

  it("si una escritura falla responde 500 y no sigue: el proveedor reintenta", async () => {
    const cause = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "contacts_organization_id_phone_normalized_key",
    });
    mocks.ingest
      .mockImplementationOnce(async () => recorded())
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("Failed query: +595981555214 Hola"), {
          cause,
        });
      });
    const messages = [textMessage(), textMessage(), textMessage()];
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook(messages)),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ingest_failed" });
    expect(mocks.ingest).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith("[whatsapp] ingest failed", {
      name: "Error",
      code: "23505",
      constraint_name: "contacts_organization_id_phone_normalized_key",
    });
  });

  it("los logs no registran teléfonos, nombres, textos, ids ni el secreto", async () => {
    const message = textMessage({ body: "Mi cédula es 1234567" });
    await handleWhatsAppWebhook(signedRequest(textWebhook([message])));
    expect(infos).toHaveBeenCalledWith(
      "[whatsapp] webhook processed",
      expect.objectContaining({ recorded: 1 }),
    );
    const text = logged();
    for (const secret of [
      "595981555214",
      "Ramón",
      "cédula",
      message.id,
      TEST_LINE_ID,
      TEST_APP_SECRET,
      ORG,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("estados de entrega (Hito 12C, DEC-044 §3.3)", () => {
  it("pide la ingesta de cada estado con lo ya validado, sin organización", async () => {
    const response = await handleWhatsAppWebhook(
      signedRequest(
        statusWebhook([
          { id: "wamid.OUT1", status: "sent", timestamp: 1_792_600_000 },
          { id: "wamid.OUT1", status: "delivered", timestamp: 1_792_600_004 },
          { id: "wamid.OUT2", status: "failed", timestamp: 1_792_600_009 },
        ]),
      ),
    );

    expect(response.status).toBe(200);
    expect(statusCalls()).toEqual([
      {
        lineId: TEST_LINE_ID,
        externalId: "wamid.OUT1",
        status: "sent",
        occurredAt: new Date(1_792_600_000 * 1000),
      },
      {
        lineId: TEST_LINE_ID,
        externalId: "wamid.OUT1",
        status: "delivered",
        occurredAt: new Date(1_792_600_004 * 1000),
      },
      {
        lineId: TEST_LINE_ID,
        externalId: "wamid.OUT2",
        status: "failed",
        occurredAt: new Date(1_792_600_009 * 1000),
      },
    ]);
    // La organización nunca sale del webhook: no hay campo para elegirla.
    expect(Object.keys(statusCalls()[0]!)).not.toContain("organizationId");
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("responde 200 con los conteos de cada resultado: un id desconocido no se reintenta", async () => {
    const outcomes: DeliveryStatusOutcome[] = [
      statusRecorded(),
      { ...statusRecorded(), outcome: "duplicate" },
      { outcome: "unknown_line" },
      { outcome: "unknown_message" },
    ];
    mocks.ingestStatus.mockImplementation(async () => outcomes.shift());
    const response = await handleWhatsAppWebhook(
      signedRequest(
        webhook({
          messaging_product: "whatsapp",
          metadata: { phone_number_id: TEST_LINE_ID },
          statuses: [
            rawStatus({
              id: "wamid.A",
              status: "read",
              timestamp: 1_792_600_000,
            }),
            rawStatus({
              id: "wamid.A",
              status: "read",
              timestamp: 1_792_600_000,
            }),
            rawStatus({
              id: "wamid.B",
              status: "sent",
              timestamp: 1_792_600_000,
            }),
            rawStatus({
              id: "wamid.C",
              status: "failed",
              timestamp: 1_792_600_000,
            }),
            { id: "wamid.D", status: "delivered" },
            rawStatus({
              id: "wamid.E",
              status: "warning",
              timestamp: 1_792_600_000,
            }),
          ],
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: 0,
      recorded: 0,
      duplicate: 0,
      unknown_line: 0,
      invalid_sender: 0,
      invalid: 0,
      ignored: 1,
      statuses: {
        received: 4,
        recorded: 1,
        duplicate: 1,
        unknown_line: 1,
        unknown_message: 1,
        invalid: 1,
      },
    });
  });

  it("en un lote con mensajes y estados, ingiere primero los mensajes y después los estados", async () => {
    const order: string[] = [];
    mocks.ingest.mockImplementation(async () => {
      order.push("message");
      return recorded();
    });
    mocks.ingestStatus.mockImplementation(async () => {
      order.push("status");
      return statusRecorded();
    });
    const response = await handleWhatsAppWebhook(
      signedRequest(
        webhook(
          messagesValue({
            messages: [rawText(textMessage())],
            statuses: [
              rawStatus({
                id: "wamid.OUT",
                status: "read",
                timestamp: 1_792_600_000,
              }),
            ],
          }),
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(order).toEqual(["message", "status"]);
    expect(await response.json()).toMatchObject({
      recorded: 1,
      statuses: { received: 1, recorded: 1 },
    });
  });

  it("si la ingesta de un estado falla responde 500 y no sigue: el proveedor reintenta", async () => {
    const cause = Object.assign(new Error("connection terminated"), {
      code: "57P01",
    });
    mocks.ingestStatus
      .mockImplementationOnce(async () => statusRecorded())
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("Failed query: wamid.OUT2"), { cause });
      });
    const response = await handleWhatsAppWebhook(
      signedRequest(
        statusWebhook([
          { id: "wamid.OUT1", status: "read", timestamp: 1_792_600_000 },
          { id: "wamid.OUT2", status: "read", timestamp: 1_792_600_000 },
          { id: "wamid.OUT3", status: "read", timestamp: 1_792_600_000 },
        ]),
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ingest_failed" });
    expect(mocks.ingestStatus).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith("[whatsapp] ingest failed", {
      name: "Error",
      code: "57P01",
      constraint_name: undefined,
    });
    expect(logged()).not.toContain("wamid.OUT2");
  });

  it("un webhook de solo estados no toca la ingesta de mensajes, y sus logs no registran ids", async () => {
    await handleWhatsAppWebhook(
      signedRequest(
        statusWebhook([
          {
            id: "wamid.SECRET01",
            status: "delivered",
            timestamp: 1_792_600_000,
          },
        ]),
      ),
    );
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(infos).toHaveBeenCalledWith(
      "[whatsapp] webhook processed",
      expect.objectContaining({
        statuses: expect.objectContaining({ recorded: 1 }),
      }),
    );
    const text = logged();
    for (const secret of [
      "wamid.SECRET01",
      "595981555214",
      TEST_LINE_ID,
      ORG,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("route handler (app/api/webhooks/whatsapp)", () => {
  it("corre en Node y delega en el webhook", async () => {
    expect(route.runtime).toBe("nodejs");
    const response = await route.POST(
      signedRequest(textWebhook([textMessage()])),
    );
    expect(response.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
  });

  it("solo exporta GET (verificación), POST (eventos) y runtime", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST", "runtime"]);
  });
});
