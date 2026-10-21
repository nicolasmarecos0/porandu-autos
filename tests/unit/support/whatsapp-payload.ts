import { createHmac } from "node:crypto";

/*
 * Payloads sintéticos del webhook de la WhatsApp Cloud API, con la forma que
 * documenta Meta (object → entry → changes → value). Ningún número, id ni
 * secreto corresponde a una cuenta real.
 */

/** phone_number_id de una línea de prueba. */
export const TEST_LINE_ID = "100000000000001";

/** Secreto de prueba: 32 caracteres, como el app secret de Meta. */
export const TEST_APP_SECRET = "0123456789abcdef0123456789abcdef";

export type TestTextMessage = {
  id: string;
  from: string;
  /** Segundos Unix. */
  timestamp: number;
  body: string;
};

let sequence = 0;

/** Un mensaje de texto entrante, con un id único por llamada. */
export function textMessage(
  overrides: Partial<TestTextMessage> = {},
): TestTextMessage {
  sequence += 1;
  return {
    id: `wamid.TEST${String(sequence).padStart(8, "0")}`,
    from: "595981555214",
    timestamp: 1_792_600_000,
    body: "Hola, ¿sigue disponible la Hilux?",
    ...overrides,
  };
}

type ValueOptions = {
  lineId?: string;
  /** Nombre de perfil por wa_id; `null` omite `contacts`. */
  profiles?: Record<string, string> | null;
  messages?: unknown[];
  statuses?: unknown[];
};

/** El `value` de un cambio del campo `messages`. */
export function messagesValue({
  lineId = TEST_LINE_ID,
  profiles = { "595981555214": "Ramón Benítez" },
  messages = [],
  statuses,
}: ValueOptions = {}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: "595210000000",
      phone_number_id: lineId,
    },
    ...(profiles === null
      ? {}
      : {
          contacts: Object.entries(profiles).map(([waId, name]) => ({
            profile: { name },
            wa_id: waId,
          })),
        }),
    messages,
    ...(statuses === undefined ? {} : { statuses }),
  };
}

/** Un mensaje del payload de la Cloud API (`type: "text"`). */
export function rawText(message: TestTextMessage): Record<string, unknown> {
  return {
    from: message.from,
    id: message.id,
    timestamp: String(message.timestamp),
    text: { body: message.body },
    type: "text",
  };
}

/** Webhook con un cambio por cada `value`. */
export function webhook(
  ...values: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000002",
        changes: values.map((value) => ({ field: "messages", value })),
      },
    ],
  };
}

/** Webhook con mensajes de texto a una línea. */
export function textWebhook(
  messages: TestTextMessage[],
  options: Omit<ValueOptions, "messages"> = {},
): Record<string, unknown> {
  return webhook(
    messagesValue({ ...options, messages: messages.map(rawText) }),
  );
}

/** `X-Hub-Signature-256` de `body` con `secret`. */
export function signature(body: string, secret = TEST_APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Un POST firmado al webhook, como lo envía el proveedor. */
export function signedRequest(
  payload: unknown,
  { secret = TEST_APP_SECRET }: { secret?: string } = {},
): Request {
  const body = JSON.stringify(payload);
  return new Request("https://porandu.test/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature(body, secret),
    },
    body,
  });
}
