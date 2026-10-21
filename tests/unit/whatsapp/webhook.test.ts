import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/webhooks/whatsapp/route";
import type {
  InboundMessageOutcome,
  InboundMessageWrite,
} from "@/db/queries/ingest-whatsapp-message";
import {
  handleWhatsAppWebhook,
  MAX_WEBHOOK_BODY_BYTES,
} from "@/lib/whatsapp/webhook";

import {
  messagesValue,
  signature,
  signedRequest,
  TEST_APP_SECRET,
  TEST_LINE_ID,
  textMessage,
  textWebhook,
  webhook,
} from "../support/whatsapp-payload";

/*
 * Webhook de WhatsApp (Hito 7, DEC-039) sin base de datos: secreto, cota del
 * cuerpo, firma, validación y lo que se le pide a la ingesta, con la
 * escritura simulada. La ingesta real contra PostgreSQL 17 está en
 * tests/db/whatsapp-ingestion.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  ingest: vi.fn<(message: unknown) => Promise<unknown>>(),
}));

vi.mock("@/db/queries/ingest-whatsapp-message", () => ({
  ingestInboundMessage: mocks.ingest,
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

let errors: ReturnType<typeof vi.spyOn>;
let infos: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("WHATSAPP_APP_SECRET", TEST_APP_SECRET);
  mocks.ingest.mockReset();
  mocks.ingest.mockImplementation(async () => recorded());
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
        statuses: [{ id: "wamid.OUT", status: "read" }],
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
      ignored: 1,
    });
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

describe("route handler (app/api/webhooks/whatsapp)", () => {
  it("corre en Node y delega en el webhook", async () => {
    expect(route.runtime).toBe("nodejs");
    const response = await route.POST(
      signedRequest(textWebhook([textMessage()])),
    );
    expect(response.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
  });

  it("solo exporta POST", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
  });
});
