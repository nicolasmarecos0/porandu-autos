import { describe, expect, it } from "vitest";

import { parseWhatsAppWebhook } from "@/domains/webhooks/whatsapp";

import {
  messagesValue,
  rawText,
  TEST_LINE_ID,
  textMessage,
  textWebhook,
  webhook,
} from "../../support/whatsapp-payload";

/*
 * Payload del webhook de la WhatsApp Cloud API (Hito 7, DEC-039 §3): sobre
 * estricto, mensajes de texto traducidos al contrato propio, el resto
 * ignorado y lo inválido descartado sin escribir.
 */

describe("parseWhatsAppWebhook: mensajes de texto", () => {
  it("traduce un mensaje de texto al contrato propio", () => {
    const message = textMessage({
      timestamp: 1_792_600_000,
      body: "  Hola,\r\n¿sigue   disponible?  ",
    });
    expect(parseWhatsAppWebhook(textWebhook([message]))).toEqual({
      ok: true,
      messages: [
        {
          lineId: TEST_LINE_ID,
          externalId: message.id,
          from: "595981555214",
          profileName: "Ramón Benítez",
          // Normalizado como un mensaje (DEC-036 §4).
          content: "Hola,\n¿sigue disponible?",
          sentAt: new Date(1_792_600_000 * 1000),
        },
      ],
      ignored: 0,
      invalid: 0,
    });
  });

  it("mantiene el orden y toma el perfil de cada remitente por wa_id", () => {
    const first = textMessage({ from: "595981555214" });
    const second = textMessage({ from: "595985555119" });
    const third = textMessage({ from: "595983555846" });
    const parsed = parseWhatsAppWebhook(
      textWebhook([first, second, third], {
        profiles: { "595985555119": "Fátima", "595981555214": "Ramón" },
      }),
    );
    expect(parsed.ok && parsed.messages.map((m) => m.externalId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(parsed.ok && parsed.messages.map((m) => m.profileName)).toEqual([
      "Ramón",
      "Fátima",
      // Sin perfil para ese número.
      null,
    ]);
  });

  it("sin contacts, el perfil queda vacío", () => {
    const parsed = parseWhatsAppWebhook(
      textWebhook([textMessage()], { profiles: null }),
    );
    expect(parsed.ok && parsed.messages[0]?.profileName).toBeNull();
  });

  it("varias entradas y cambios, cada uno con su línea", () => {
    const a = textMessage();
    const b = textMessage();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: messagesValue({ lineId: "111", messages: [rawText(a)] }),
            },
          ],
        },
        {
          id: "2",
          changes: [
            {
              field: "messages",
              value: messagesValue({ lineId: "222", messages: [rawText(b)] }),
            },
          ],
        },
      ],
    };
    const parsed = parseWhatsAppWebhook(payload);
    expect(
      parsed.ok && parsed.messages.map((m) => [m.lineId, m.externalId]),
    ).toEqual([
      ["111", a.id],
      ["222", b.id],
    ]);
  });

  it("tolera campos nuevos del proveedor (un campo de más no pierde mensajes)", () => {
    const message = textMessage();
    const payload = webhook({
      ...messagesValue({
        messages: [
          {
            ...rawText(message),
            context: { forwarded: true },
            new_field: { anything: 1 },
          },
        ],
      }),
      another_new_field: "x",
    });
    const parsed = parseWhatsAppWebhook({ ...payload, extra: true });
    expect(parsed.ok && parsed.messages.map((m) => m.externalId)).toEqual([
      message.id,
    ]);
  });
});

describe("parseWhatsAppWebhook: lo que no se ingiere", () => {
  it("ignora estados de entrega, mensajes que no son de texto y otros campos", () => {
    const text = textMessage();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: messagesValue({
                messages: [
                  rawText(text),
                  {
                    from: "595981555214",
                    id: "wamid.IMG",
                    timestamp: "1792600000",
                    type: "image",
                    image: { id: "1", mime_type: "image/jpeg" },
                  },
                  {
                    from: "595981555214",
                    id: "wamid.REACT",
                    timestamp: "1792600000",
                    type: "reaction",
                    reaction: { message_id: "wamid.X", emoji: "👍" },
                  },
                ],
                statuses: [
                  { id: "wamid.OUT", status: "delivered" },
                  { id: "wamid.OUT", status: "read" },
                ],
              }),
            },
            { field: "account_update", value: { event: "VERIFIED" } },
          ],
        },
      ],
    };
    const parsed = parseWhatsAppWebhook(payload);
    expect(parsed).toMatchObject({ ok: true, ignored: 5, invalid: 0 });
    expect(parsed.ok && parsed.messages.map((m) => m.externalId)).toEqual([
      text.id,
    ]);
  });

  it("un webhook de solo estados no trae mensajes", () => {
    expect(
      parseWhatsAppWebhook(
        webhook(
          messagesValue({
            messages: [],
            statuses: [{ id: "wamid.OUT", status: "sent" }],
          }),
        ),
      ),
    ).toEqual({ ok: true, messages: [], ignored: 1, invalid: 0 });
  });

  it.each([
    ["texto vacío", { body: "" }],
    ["texto solo con espacios", { body: " \n\t " }],
    ["texto de más de 4096", { body: "x".repeat(4097) }],
    ["from con +", { from: "+595981555214" }],
    ["from con letras", { from: "59598155521a" }],
    ["id vacío", { id: "" }],
    ["id con espacios", { id: "wamid. x" }],
    ["timestamp anterior a 2000", { timestamp: 946_684_799 }],
    ["timestamp desde 2100", { timestamp: 4_102_444_800 }],
  ])(
    "descarta un mensaje de texto con %s, y sigue con el resto",
    (_, overrides) => {
      const good = textMessage();
      const bad = textMessage(overrides);
      const parsed = parseWhatsAppWebhook(textWebhook([bad, good]));
      expect(parsed).toMatchObject({ ok: true, ignored: 0, invalid: 1 });
      expect(parsed.ok && parsed.messages.map((m) => m.externalId)).toEqual([
        good.id,
      ]);
    },
  );

  it.each([
    ["sin type", { from: "595981555214", id: "w", timestamp: "1" }],
    ["text sin body", { ...rawText(textMessage()), text: {} }],
    ["timestamp numérico", { ...rawText(textMessage()), timestamp: 1 }],
    ["no es un objeto", "hola"],
  ])("descarta un mensaje mal formado: %s", (_, raw) => {
    expect(
      parseWhatsAppWebhook(webhook(messagesValue({ messages: [raw] }))),
    ).toEqual({ ok: true, messages: [], ignored: 0, invalid: 1 });
  });

  it("acepta exactamente 4096 caracteres", () => {
    const parsed = parseWhatsAppWebhook(
      textWebhook([textMessage({ body: "x".repeat(4096) })]),
    );
    expect(parsed).toMatchObject({ ok: true, invalid: 0 });
  });
});

describe("parseWhatsAppWebhook: sobre inválido", () => {
  it.each([
    ["null", null],
    ["un texto", "hola"],
    ["otro object", { object: "page", entry: [] }],
    ["sin entry", { object: "whatsapp_business_account" }],
    ["entry vacío", { object: "whatsapp_business_account", entry: [] }],
    [
      "changes no es una lista",
      { object: "whatsapp_business_account", entry: [{ changes: {} }] },
    ],
    [
      "otro messaging_product",
      webhook({ ...messagesValue(), messaging_product: "instagram" }),
    ],
    ["sin metadata", webhook({ messaging_product: "whatsapp", messages: [] })],
    [
      "phone_number_id con letras",
      webhook(messagesValue({ lineId: "line-1" })),
    ],
    [
      "phone_number_id numérico (no texto)",
      webhook({
        ...messagesValue(),
        metadata: { phone_number_id: 100000000000001 },
      }),
    ],
    [
      "messages no es una lista",
      webhook({ ...messagesValue(), messages: { a: 1 } }),
    ],
  ])("rechaza %s sin ingerir nada", (_, payload) => {
    expect(parseWhatsAppWebhook(payload)).toEqual({ ok: false });
  });

  it("un sobre inválido en un cambio invalida todo el webhook", () => {
    const payload = webhook(
      messagesValue({ messages: [rawText(textMessage())] }),
      { ...messagesValue(), metadata: {} },
    );
    expect(parseWhatsAppWebhook(payload)).toEqual({ ok: false });
  });
});
