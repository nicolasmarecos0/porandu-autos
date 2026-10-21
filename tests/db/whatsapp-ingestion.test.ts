import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ingestInboundMessage,
  type InboundMessageWrite,
} from "@/db/queries/ingest-whatsapp-message";
import { selectOpportunityMessages } from "@/db/queries/messages";
import { contacts, conversations, messages, whatsappLines } from "@/db/schema";
import { withIngestion, withTenant } from "@/db/tenant";
import { activityTimeline } from "@/domains/conversations/timeline";
import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook";

import {
  signedRequest,
  TEST_APP_SECRET,
  textMessage,
  textWebhook,
} from "../unit/support/whatsapp-payload";
import { closureColumns } from "./support/closures";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool, runtimePool } from "./support/runtime";
import {
  ORG_1,
  ORG_2,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
} from "./support/tenants";

/*
 * Ingesta de mensajes entrantes de WhatsApp (Hito 7, DEC-039) contra
 * PostgreSQL 17 con las migraciones aplicadas, por el boundary real
 * (withIngestion(), conectado como app_runtime que asume authenticated sin
 * claims):
 *
 *   ingestInboundMessage() → withIngestion() →
 *   private.ingest_whatsapp_message() (SECURITY DEFINER): la organización de
 *   la línea → contacto → conversación abierta → oportunidad abierta única →
 *   mensaje (idempotente) → último mensaje de la conversación → trigger de
 *   actividad (DEC-036)
 *
 * Prueba que el tenant sale solo de la línea receptora, la resolución de
 * contacto y conversación, la idempotencia y las carreras (varias
 * conexiones del pool de runtime a la vez), el muro del Hito 4, que la
 * identidad de sistema no lee ni escribe nada por sí misma, que un miembro
 * no puede ingerir y el webhook de punta a punta con la firma.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2.
 * Líneas: LINE_1 → ORG_1 · LINE_2 → ORG_2 · LINE_OFF → ORG_1, inactiva.
 */

vi.mock("server-only", () => ({}));

const LINE_1 = "100000000000001";
const LINE_2 = "100000000000002";
const LINE_OFF = "100000000000003";

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  // Las líneas las da de alta el provisioning con el rol dueño (DEC-039 §5).
  await db.admin`
    INSERT INTO public.whatsapp_lines ${db.admin([
      { organization_id: ORG_1, phone_number_id: LINE_1, active: true },
      { organization_id: ORG_2, phone_number_id: LINE_2, active: true },
      { organization_id: ORG_1, phone_number_id: LINE_OFF, active: false },
    ])}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
  vi.stubEnv("WHATSAPP_APP_SECRET", TEST_APP_SECRET);
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

let sequence = 0;

/** Un número de origen propio del caso, en E.164. */
function phone(): string {
  sequence += 1;
  return `+595981${String(100_000 + sequence).padStart(6, "0")}`;
}

/** Un mensaje para ingerir, con un id del proveedor propio del caso. */
function inbound(
  overrides: Partial<InboundMessageWrite> = {},
): InboundMessageWrite {
  sequence += 1;
  const from = overrides.phoneNormalized ?? phone();
  return {
    lineId: LINE_1,
    externalId: `wamid.DB${String(sequence).padStart(8, "0")}`,
    phone: from,
    phoneNormalized: from,
    contactName: "Cliente de prueba",
    content: `Mensaje ${sequence}`,
    preview: `Mensaje ${sequence}`,
    sentAt: new Date("2026-10-21T12:00:00Z"),
    ...overrides,
  };
}

type Row = Record<string, unknown>;

/** Filas de una tabla con el superusuario (sin RLS), por una condición. */
async function rows(table: string, where: string, value: unknown) {
  return db.admin.unsafe<Row[]>(
    `SELECT * FROM public.${table} WHERE ${where} = $1 ORDER BY created_at, id`,
    [value as string],
  );
}

async function countAll(): Promise<Row> {
  const [row] = await db.admin<Row[]>`
    SELECT
      (SELECT count(*)::int FROM public.contacts) AS contacts,
      (SELECT count(*)::int FROM public.conversations) AS conversations,
      (SELECT count(*)::int FROM public.messages) AS messages
  `;
  return row!;
}

const DAY = 86_400_000;

/** Una oportunidad en `stage` de un contacto, con actividad hace un día. */
async function opportunity(
  organizationId: string,
  contactId: string,
  stage: "new" | "qualifying" | "negotiating" | "lost" = "qualifying",
): Promise<string> {
  const id = randomUUID();
  const at = new Date(Date.now() - DAY);
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      source: "whatsapp",
      ...closureColumns(stage),
      last_activity_at: at,
      created_at: at,
      updated_at: at,
    })}
  `;
  return id;
}

/** Un contacto existente (alta manual) con ese teléfono. */
async function existingContact(
  organizationId: string,
  phoneNormalized: string,
): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name, phone,
      phone_normalized, city)
    VALUES (${id}, ${organizationId}, 'Ramón Benítez', '0981 555 214',
      ${phoneNormalized}, 'Luque')
  `;
  return id;
}

describe("tenant por la línea receptora (DEC-039 §5)", () => {
  it("un mensaje a la línea de ORG_1 se registra entero en ORG_1, sin autor", async () => {
    const message = inbound({ contactName: "Ramón", content: "Hola\nmundo" });
    const result = await ingestInboundMessage(message);

    expect(result).toMatchObject({
      outcome: "recorded",
      organizationId: ORG_1,
      opportunityId: null,
    });
    if (result.outcome !== "recorded") throw new Error("not recorded");

    const [contact] = await rows("contacts", "id", result.contactId);
    expect(contact).toMatchObject({
      organization_id: ORG_1,
      name: "Ramón",
      phone: message.phone,
      phone_normalized: message.phoneNormalized,
      city: null,
    });
    const [conversation] = await rows(
      "conversations",
      "id",
      result.conversationId,
    );
    expect(conversation).toMatchObject({
      organization_id: ORG_1,
      contact_id: result.contactId,
      channel: "whatsapp",
      status: "open",
      last_message_at: message.sentAt,
      last_message_preview: message.preview,
    });
    const [stored] = await rows("messages", "id", result.messageId);
    expect(stored).toMatchObject({
      organization_id: ORG_1,
      contact_id: result.contactId,
      conversation_id: result.conversationId,
      opportunity_id: null,
      channel: "whatsapp",
      direction: "inbound",
      content: "Hola\nmundo",
      recorded_by: null,
      external_id: message.externalId,
      sent_at: message.sentAt,
    });
    // created_at es el reloj de la base (cuándo lo registró Porandú).
    expect(
      Math.abs((stored!.created_at as Date).getTime() - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("el mismo número a la línea de ORG_2 es otro contacto y otra conversación, en ORG_2", async () => {
    const from = phone();
    const one = await ingestInboundMessage(
      inbound({ lineId: LINE_1, phoneNormalized: from }),
    );
    const two = await ingestInboundMessage(
      inbound({ lineId: LINE_2, phoneNormalized: from }),
    );
    if (one.outcome !== "recorded" || two.outcome !== "recorded") {
      throw new Error("not recorded");
    }
    expect(two.organizationId).toBe(ORG_2);
    expect(two.contactId).not.toBe(one.contactId);
    expect(two.conversationId).not.toBe(one.conversationId);
    const owners = await db.admin<{ organization_id: string }[]>`
      SELECT organization_id FROM public.contacts
      WHERE phone_normalized = ${from} ORDER BY organization_id
    `;
    expect(owners.map((o) => o.organization_id)).toEqual([ORG_1, ORG_2]);
  });

  it.each([
    ["desconocida", "999999999999999"],
    ["inactiva", LINE_OFF],
  ])("una línea %s es unknown_line y no escribe nada", async (_, lineId) => {
    const before = await countAll();
    expect(await ingestInboundMessage(inbound({ lineId }))).toEqual({
      outcome: "unknown_line",
    });
    expect(await countAll()).toEqual(before);
  });

  it("RLS: cada miembro ve solo las conversaciones y los mensajes ingeridos de su organización", async () => {
    const from = phone();
    const one = await ingestInboundMessage(
      inbound({ lineId: LINE_1, phoneNormalized: from }),
    );
    const two = await ingestInboundMessage(
      inbound({ lineId: LINE_2, phoneNormalized: from }),
    );
    if (one.outcome !== "recorded" || two.outcome !== "recorded") {
      throw new Error("not recorded");
    }

    for (const [user, org, own, foreign] of [
      [USER_A, ORG_1, one, two],
      [USER_B, ORG_2, two, one],
    ] as const) {
      const seen = await withTenant(tenantContext(user, org), async (tx) => ({
        conversations: (
          await tx.select({ id: conversations.id }).from(conversations)
        ).map((r) => r.id),
        messages: (await tx.select({ id: messages.id }).from(messages)).map(
          (r) => r.id,
        ),
      }));
      expect(seen.conversations).toContain(own.conversationId);
      expect(seen.conversations).not.toContain(foreign.conversationId);
      expect(seen.messages).toContain(own.messageId);
      expect(seen.messages).not.toContain(foreign.messageId);
    }
  });
});

describe("contacto y conversación (DEC-039 §7)", () => {
  it("reutiliza el contacto existente con ese teléfono sin cambiarle nombre ni ciudad", async () => {
    const from = phone();
    const contactId = await existingContact(ORG_1, from);
    const result = await ingestInboundMessage(
      inbound({ phoneNormalized: from, contactName: "Otro nombre" }),
    );
    expect(result).toMatchObject({ outcome: "recorded", contactId });
    const [contact] = await rows("contacts", "id", contactId);
    expect(contact).toMatchObject({ name: "Ramón Benítez", city: "Luque" });
  });

  it("los mensajes siguientes van a la misma conversación abierta y la conversación guarda el último", async () => {
    const from = phone();
    const first = await ingestInboundMessage(
      inbound({
        phoneNormalized: from,
        preview: "Primero",
        sentAt: new Date("2026-10-21T12:00:00Z"),
      }),
    );
    const second = await ingestInboundMessage(
      inbound({
        phoneNormalized: from,
        preview: "Segundo",
        sentAt: new Date("2026-10-21T12:05:00Z"),
      }),
    );
    if (first.outcome !== "recorded" || second.outcome !== "recorded") {
      throw new Error("not recorded");
    }
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.contactId).toBe(first.contactId);
    const [conversation] = await rows(
      "conversations",
      "id",
      first.conversationId,
    );
    expect(conversation).toMatchObject({
      last_message_at: new Date("2026-10-21T12:05:00Z"),
      last_message_preview: "Segundo",
    });
    expect((conversation!.updated_at as Date).getTime()).toBeGreaterThanOrEqual(
      (conversation!.created_at as Date).getTime(),
    );
  });

  it("un mensaje más viejo que llega tarde se registra, pero no pisa el último de la conversación", async () => {
    const from = phone();
    const newer = await ingestInboundMessage(
      inbound({
        phoneNormalized: from,
        preview: "Nuevo",
        sentAt: new Date("2026-10-21T12:10:00Z"),
      }),
    );
    const late = await ingestInboundMessage(
      inbound({
        phoneNormalized: from,
        preview: "Viejo",
        sentAt: new Date("2026-10-21T12:01:00Z"),
      }),
    );
    expect(late.outcome).toBe("recorded");
    if (newer.outcome !== "recorded") throw new Error("not recorded");
    const [conversation] = await rows(
      "conversations",
      "id",
      newer.conversationId,
    );
    expect(conversation).toMatchObject({
      last_message_at: new Date("2026-10-21T12:10:00Z"),
      last_message_preview: "Nuevo",
    });
  });

  it("con el mismo instante, el último registrado queda como último", async () => {
    const from = phone();
    const at = new Date("2026-10-21T13:00:00Z");
    await ingestInboundMessage(
      inbound({ phoneNormalized: from, preview: "Uno", sentAt: at }),
    );
    const two = await ingestInboundMessage(
      inbound({ phoneNormalized: from, preview: "Dos", sentAt: at }),
    );
    if (two.outcome !== "recorded") throw new Error("not recorded");
    const [conversation] = await rows(
      "conversations",
      "id",
      two.conversationId,
    );
    expect(conversation?.last_message_preview).toBe("Dos");
  });

  it("si la conversación del contacto se cerró, abre una nueva", async () => {
    const from = phone();
    const first = await ingestInboundMessage(
      inbound({ phoneNormalized: from }),
    );
    if (first.outcome !== "recorded") throw new Error("not recorded");
    await db.admin`
      UPDATE public.conversations SET status = 'closed'
      WHERE id = ${first.conversationId}
    `;
    const second = await ingestInboundMessage(
      inbound({ phoneNormalized: from }),
    );
    if (second.outcome !== "recorded") throw new Error("not recorded");
    expect(second.conversationId).not.toBe(first.conversationId);
    expect(second.contactId).toBe(first.contactId);
    const open = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.conversations
      WHERE contact_id = ${first.contactId} AND status = 'open'
    `;
    expect(open[0]?.count).toBe(1);
  });
});

describe("idempotencia (DEC-039 §8)", () => {
  it("el mismo id del proveedor dos veces es duplicate: una sola fila y el último mensaje no cambia", async () => {
    const message = inbound({ preview: "Original" });
    const first = await ingestInboundMessage(message);
    const again = await ingestInboundMessage({
      ...message,
      content: "Otro texto",
      preview: "Otro texto",
      sentAt: new Date("2026-10-22T00:00:00Z"),
    });
    if (first.outcome !== "recorded") throw new Error("not recorded");
    expect(again).toEqual({ ...first, outcome: "duplicate" });

    const stored = await rows("messages", "external_id", message.externalId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe(message.content);
    const [conversation] = await rows(
      "conversations",
      "id",
      first.conversationId,
    );
    expect(conversation?.last_message_preview).toBe("Original");
  });

  it("la idempotencia es por organización", async () => {
    const externalId = `wamid.SHARED${randomUUID()}`;
    const one = await ingestInboundMessage(
      inbound({ lineId: LINE_1, externalId }),
    );
    const two = await ingestInboundMessage(
      inbound({ lineId: LINE_2, externalId }),
    );
    expect([one.outcome, two.outcome]).toEqual(["recorded", "recorded"]);
  });
});

describe("carreras (DEC-039 §8)", () => {
  it("varios mensajes simultáneos del mismo número nuevo: un contacto, una conversación y todos los mensajes", async () => {
    const from = phone();
    const batch = Array.from({ length: 8 }, (_, i) =>
      inbound({
        phoneNormalized: from,
        // Todos en el mismo milisegundo salvo el último, que es el más nuevo.
        sentAt: new Date(
          Date.UTC(2026, 9, 21, 14, 0, 0, 0) + (i === 7 ? 1 : 0),
        ),
        preview: `Simultáneo ${i}`,
      }),
    );

    const results = await Promise.all(batch.map(ingestInboundMessage));

    expect(results.map((r) => r.outcome)).toEqual(
      Array(batch.length).fill("recorded"),
    );
    const contactRows = await rows("contacts", "phone_normalized", from);
    expect(contactRows).toHaveLength(1);
    const contactId = contactRows[0]!.id as string;
    const conversationRows = await rows(
      "conversations",
      "contact_id",
      contactId,
    );
    expect(conversationRows).toHaveLength(1);
    expect(conversationRows[0]?.last_message_preview).toBe("Simultáneo 7");
    expect(await rows("messages", "contact_id", contactId)).toHaveLength(8);
    expect(
      new Set(results.map((r) => "contactId" in r && r.contactId)),
    ).toEqual(new Set([contactId]));
  });

  /*
   * Determinista: otra transacción ya insertó la fila y sigue abierta. La
   * ingesta choca con el índice único, espera la confirmación y reutiliza
   * esa fila (ON CONFLICT DO NOTHING y relectura). Si no esperara, crearía
   * la suya y la otra transacción fallaría al confirmar.
   */
  async function whileHeld(
    insert: (tx: TransactionSql) => Promise<unknown>,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    let inserted!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (inserted = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = db.admin.begin(async (tx) => {
      await insert(tx);
      inserted();
      await gate;
    });
    await ready;
    const pending = run();
    // La ingesta queda bloqueada en el índice mientras la otra no confirma.
    const early = await Promise.race([
      pending.then(() => "finished"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
    ]);
    expect(early).toBe("waiting");
    release();
    await holder;
    return pending;
  }

  it("un contacto nuevo del mismo número en otra transacción abierta: espera y lo reutiliza", async () => {
    const from = phone();
    const contactId = randomUUID();
    const result = await whileHeld(
      (tx) => tx`
        INSERT INTO public.contacts (id, organization_id, name, phone,
          phone_normalized)
        VALUES (${contactId}, ${ORG_1}, 'Alta simultánea', ${from}, ${from})
      `,
      () => ingestInboundMessage(inbound({ phoneNormalized: from })),
    );
    expect(result).toMatchObject({ outcome: "recorded", contactId });
    expect(await rows("contacts", "phone_normalized", from)).toHaveLength(1);
  });

  it("una conversación abierta del contacto en otra transacción abierta: espera y la reutiliza", async () => {
    const from = phone();
    const contactId = await existingContact(ORG_1, from);
    const conversationId = randomUUID();
    const result = await whileHeld(
      (tx) => tx`
        INSERT INTO public.conversations (id, organization_id, contact_id,
          channel)
        VALUES (${conversationId}, ${ORG_1}, ${contactId}, 'whatsapp')
      `,
      () => ingestInboundMessage(inbound({ phoneNormalized: from })),
    );
    expect(result).toMatchObject({
      outcome: "recorded",
      contactId,
      conversationId,
    });
  });

  it("el mismo mensaje en otra transacción abierta: espera y es duplicate", async () => {
    const first = await ingestInboundMessage(inbound());
    if (first.outcome !== "recorded") throw new Error("not recorded");
    const externalId = `wamid.HELD${randomUUID()}`;
    const [contact] = await rows("contacts", "id", first.contactId);
    const result = await whileHeld(
      (tx) => tx`
        INSERT INTO public.messages (organization_id, contact_id,
          conversation_id, channel, direction, content, external_id, sent_at)
        VALUES (${ORG_1}, ${first.contactId}, ${first.conversationId},
          'whatsapp', 'inbound', 'Primera entrega', ${externalId}, now())
      `,
      () =>
        ingestInboundMessage(
          inbound({
            externalId,
            phoneNormalized: contact!.phone_normalized as string,
          }),
        ),
    );
    expect(result).toMatchObject({
      outcome: "duplicate",
      conversationId: first.conversationId,
    });
    expect(await rows("messages", "external_id", externalId)).toHaveLength(1);
  });

  it("varias entregas simultáneas del mismo mensaje dejan una sola fila", async () => {
    const message = inbound();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ingestInboundMessage(message)),
    );
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "recorded",
    ]);
    expect(
      await rows("messages", "external_id", message.externalId),
    ).toHaveLength(1);
    expect(
      await rows("contacts", "phone_normalized", message.phoneNormalized),
    ).toHaveLength(1);
  });
});

describe("muro del Hito 4 (DEC-039 §9)", () => {
  async function lastActivity(opportunityId: string) {
    const [row] = await db.admin<{ last: Date; updated: Date }[]>`
      SELECT last_activity_at AS last, updated_at AS updated
      FROM public.opportunities WHERE id = ${opportunityId}
    `;
    return row!;
  }

  it("con una sola oportunidad abierta, el mensaje va a su muro y mueve su recencia (no updated_at)", async () => {
    const from = phone();
    const contactId = await existingContact(ORG_1, from);
    const opportunityId = await opportunity(ORG_1, contactId, "negotiating");
    const before = await lastActivity(opportunityId);

    const result = await ingestInboundMessage(
      inbound({ phoneNormalized: from, content: "¿Me pasan la cuota?" }),
    );

    expect(result).toMatchObject({ outcome: "recorded", opportunityId });
    const after = await lastActivity(opportunityId);
    expect(after.last.getTime()).toBeGreaterThan(before.last.getTime());
    expect(after.updated).toEqual(before.updated);

    // El muro del detalle lo muestra, sin autor.
    const wall = await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      selectOpportunityMessages(tx, ORG_1, opportunityId),
    );
    expect(wall).toHaveLength(1);
    expect(activityTimeline([], wall, USER_A)[0]).toMatchObject({
      label: "Mensaje recibido",
      channelLabel: "WhatsApp",
      author: "WhatsApp (automático)",
      body: "¿Me pasan la cuota?",
    });
  });

  it("con una abierta y una cerrada, va a la abierta", async () => {
    const from = phone();
    const contactId = await existingContact(ORG_1, from);
    await opportunity(ORG_1, contactId, "lost");
    const open = await opportunity(ORG_1, contactId, "new");
    expect(
      await ingestInboundMessage(inbound({ phoneNormalized: from })),
    ).toMatchObject({ outcome: "recorded", opportunityId: open });
  });

  it.each([
    ["ninguna oportunidad", [] as const],
    ["dos abiertas", ["new", "qualifying"] as const],
    ["solo una cerrada", ["lost"] as const],
  ])(
    "con %s, el mensaje queda solo en la conversación y no toca ninguna",
    async (_, stages) => {
      const from = phone();
      const contactId = await existingContact(ORG_1, from);
      const ids: string[] = [];
      for (const stage of stages) {
        ids.push(await opportunity(ORG_1, contactId, stage));
      }
      const before = await Promise.all(ids.map(lastActivity));

      const result = await ingestInboundMessage(
        inbound({ phoneNormalized: from }),
      );

      expect(result).toMatchObject({
        outcome: "recorded",
        opportunityId: null,
      });
      expect(await Promise.all(ids.map(lastActivity))).toEqual(before);
    },
  );

  it("una oportunidad abierta de otra organización con el mismo teléfono no se toca", async () => {
    const from = phone();
    const foreignContact = await existingContact(ORG_2, from);
    const foreign = await opportunity(ORG_2, foreignContact, "new");
    const before = await lastActivity(foreign);

    const result = await ingestInboundMessage(
      inbound({ lineId: LINE_1, phoneNormalized: from }),
    );

    expect(result).toMatchObject({
      outcome: "recorded",
      organizationId: ORG_1,
      opportunityId: null,
    });
    expect(await lastActivity(foreign)).toEqual(before);
  });
});

describe("identidad de sistema (DEC-039 §4)", () => {
  it("dentro de withIngestion() el rol es authenticated, sin claims ni usuario", async () => {
    const [identity] = await withIngestion((tx) =>
      tx.execute<{ role: string; claims: string; uid: string | null }>(
        sql`SELECT current_user AS role, coalesce(current_setting('request.jwt.claims', true), '') AS claims, auth.uid() AS uid`,
      ),
    );
    expect(identity).toEqual({ role: "authenticated", claims: "", uid: null });

    // Al terminar, la conexión vuelve a ser app_runtime sin rol ni claims.
    const pool = runtimePool();
    const [after] = await pool<{ role: string; claims: string | null }[]>`
      SELECT current_user AS role, current_setting('request.jwt.claims', true) AS claims
    `;
    expect(after?.role).toBe("app_runtime");
    expect(after?.claims ?? "").toBe("");
  });

  it("sin claims no ve ninguna fila: RLS falla cerrado con cero filas", async () => {
    await ingestInboundMessage(inbound());
    const seen = await withIngestion(async (tx) => ({
      contacts: await tx.select().from(contacts),
      conversations: await tx.select().from(conversations),
      messages: await tx.select().from(messages),
    }));
    expect(seen).toEqual({ contacts: [], conversations: [], messages: [] });
  });

  it.each([
    [
      "leer whatsapp_lines",
      () => withIngestion((tx) => tx.select().from(whatsappLines)),
    ],
    [
      "crear un contacto",
      () =>
        withIngestion((tx) =>
          tx.insert(contacts).values({ organizationId: ORG_1, name: "X" }),
        ),
    ],
    [
      "editar una conversación",
      () =>
        withIngestion((tx) =>
          tx
            .update(conversations)
            .set({ lastMessagePreview: "X" })
            .where(eq(conversations.organizationId, ORG_1)),
        ),
    ],
  ])("sin claims no puede %s por sí mismo (42501)", async (_, run) => {
    await expect(run()).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("la función exige todos los argumentos (22004)", async () => {
    await expect(
      withIngestion((tx) =>
        tx.execute(
          sql`SELECT * FROM private.ingest_whatsapp_message(${LINE_1}, NULL, '+595981555214', '+595981555214', 'X', 'Hola', 'Hola', now())`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "22004" } });
  });

  it("un miembro, con sus claims, no puede ejecutar la función de ingesta (42501) y no escribe nada", async () => {
    const before = await countAll();
    for (const [user, org, line] of [
      [USER_A, ORG_1, LINE_1],
      // Ni siquiera en la línea de otra organización.
      [USER_A, ORG_1, LINE_2],
      [USER_B, ORG_2, LINE_1],
    ] as const) {
      await expect(
        withTenant(tenantContext(user, org), (tx) =>
          tx.execute(
            sql`SELECT * FROM private.ingest_whatsapp_message(${line}, ${`wamid.MEMBER${randomUUID()}`}, '+595981555214', '+595981555214', 'X', 'Hola', 'Hola', now())`,
          ),
        ),
      ).rejects.toMatchObject({
        cause: {
          code: "42501",
          message: expect.stringMatching(/ingestion_without_user/),
        },
      });
    }
    expect(await countAll()).toEqual(before);
  });

  it("app_runtime sin asumir authenticated no puede ejecutarla (42501)", async () => {
    const pool = runtimePool();
    await expect(
      pool`SELECT * FROM private.ingest_whatsapp_message(${LINE_1}, 'wamid.RUNTIME', '+595981555214', '+595981555214', 'X', 'Hola', 'Hola', now())`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("un miembro no puede escribir un mensaje con forma de ingerido", async () => {
    const result = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded") throw new Error("not recorded");
    const ctx = tenantContext(USER_A, ORG_1);
    const base = {
      organizationId: ORG_1,
      contactId: result.contactId,
      channel: "whatsapp" as const,
      direction: "inbound" as const,
      content: "Falso",
    };
    // Sin autor: la policy exige recorded_by = auth.uid().
    await expect(
      withTenant(ctx, (tx) =>
        tx.insert(messages).values({
          ...base,
          recordedBy: null,
          conversationId: result.conversationId,
          externalId: "wamid.FORGED",
          sentAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    // Con autor e id del proveedor: el CHECK de origen lo rechaza.
    await expect(
      withTenant(ctx, (tx) =>
        tx.insert(messages).values({
          ...base,
          recordedBy: USER_A,
          externalId: "wamid.FORGED",
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "messages_source_check" },
    });
  });

  it("un miembro lee conversaciones pero no las escribe, y no ve las líneas", async () => {
    const result = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded") throw new Error("not recorded");
    const ctx = tenantContext(USER_A, ORG_1);
    await expect(
      withTenant(ctx, (tx) =>
        tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, ORG_1),
              eq(conversations.id, result.conversationId),
            ),
          ),
      ),
    ).resolves.toEqual([{ id: result.conversationId }]);
    for (const run of [
      () =>
        withTenant(ctx, (tx) =>
          tx.insert(conversations).values({
            organizationId: ORG_1,
            contactId: result.contactId,
            channel: "whatsapp",
          }),
        ),
      () =>
        withTenant(ctx, (tx) =>
          tx
            .update(conversations)
            .set({ status: "closed" })
            .where(eq(conversations.id, result.conversationId)),
        ),
      () => withTenant(ctx, (tx) => tx.select().from(whatsappLines)),
    ]) {
      await expect(run()).rejects.toMatchObject({ cause: { code: "42501" } });
    }
  });

  it("los mensajes ingeridos siguen append-only para los miembros", async () => {
    const result = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded") throw new Error("not recorded");
    await expect(
      withTenant(tenantContext(USER_A, ORG_1), (tx) =>
        tx
          .update(messages)
          .set({ content: "Editado" })
          .where(eq(messages.id, result.messageId)),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("CHECKs de la base (DEC-039 §6 y §10)", () => {
  it.each([
    [
      "un ingerido sin conversación",
      { recorded_by: null, conversation_id: null },
      "messages_source_check",
    ],
    [
      "un ingerido saliente",
      { recorded_by: null, direction: "outbound" },
      "messages_source_check",
    ],
    [
      "un ingerido por email",
      { recorded_by: null, channel: "email" },
      "messages_source_check",
    ],
    [
      "un registrado con sent_at",
      { recorded_by: USER_A, conversation_id: null, external_id: null },
      "messages_source_check",
    ],
    [
      "un id del proveedor con espacios",
      { external_id: "wamid. x" },
      "messages_external_id_check",
    ],
  ])("rechaza %s", async (_, overrides, constraint) => {
    const result = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded") throw new Error("not recorded");
    const row = {
      organization_id: ORG_1,
      contact_id: result.contactId,
      conversation_id: result.conversationId,
      channel: "whatsapp",
      direction: "inbound",
      content: "Hola",
      recorded_by: null,
      external_id: `wamid.CHECK${randomUUID()}`,
      sent_at: new Date(),
      ...overrides,
    };
    await expect(
      db.admin`INSERT INTO public.messages ${db.admin(row)}`,
    ).rejects.toMatchObject({ code: "23514", constraint_name: constraint });
  });

  it("una conversación con otro contacto no se puede asociar (FK compuesta)", async () => {
    const result = await ingestInboundMessage(inbound());
    const other = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded" || other.outcome !== "recorded") {
      throw new Error("not recorded");
    }
    await expect(
      db.admin`
        INSERT INTO public.messages ${db.admin({
          organization_id: ORG_1,
          contact_id: result.contactId,
          conversation_id: other.conversationId,
          channel: "whatsapp",
          direction: "inbound",
          content: "Hola",
          external_id: `wamid.FK${randomUUID()}`,
          sent_at: new Date(),
        })}
      `,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "messages_conversation_fk",
    });
  });

  it.each([
    ["un preview con salto de línea", { last_message_preview: "a\nb" }],
    ["un preview de más de 160", { last_message_preview: "x".repeat(161) }],
    ["un preview sin fecha", { last_message_at: null }],
    ["otro canal", { channel: "email" }],
    ["otro estado", { status: "archived" }],
  ])("una conversación rechaza %s", async (_, overrides) => {
    const contactId = await existingContact(ORG_1, phone());
    await expect(
      db.admin`
        INSERT INTO public.conversations ${db.admin({
          organization_id: ORG_1,
          contact_id: contactId,
          channel: "whatsapp",
          status: "closed",
          last_message_at: new Date(),
          last_message_preview: "Hola",
          ...overrides,
        })}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("dos conversaciones abiertas del mismo contacto y canal no pueden existir", async () => {
    const result = await ingestInboundMessage(inbound());
    if (result.outcome !== "recorded") throw new Error("not recorded");
    await expect(
      db.admin`
        INSERT INTO public.conversations (organization_id, contact_id, channel)
        VALUES (${ORG_1}, ${result.contactId}, 'whatsapp')
      `,
    ).rejects.toMatchObject({
      code: "23505",
      constraint_name: "conversations_open_contact_channel_key",
    });
  });

  it("una línea pertenece a una sola organización", async () => {
    await expect(
      db.admin`
        INSERT INTO public.whatsapp_lines (organization_id, phone_number_id)
        VALUES (${ORG_2}, ${LINE_1})
      `,
    ).rejects.toMatchObject({
      code: "23505",
      constraint_name: "whatsapp_lines_phone_number_id_key",
    });
  });
});

describe("webhook de punta a punta (DEC-039 §1 a §3)", () => {
  it("un POST firmado registra los mensajes de texto, y repetirlo no duplica nada", async () => {
    const first = textMessage({ from: "595985555119", body: "Hola" });
    const second = textMessage({
      from: "595985555119",
      body: "¿Aceptan usado?",
    });
    const payload = textWebhook([first, second], {
      lineId: LINE_2,
      profiles: { "595985555119": "Fátima Giménez" },
    });

    const response = await handleWhatsAppWebhook(signedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: 2,
      recorded: 2,
      duplicate: 0,
    });

    const stored = await db.admin<
      { organization_id: string; content: string; name: string }[]
    >`
      SELECT m.organization_id, m.content, c.name
      FROM public.messages m JOIN public.contacts c ON c.id = m.contact_id
      WHERE m.external_id IN (${first.id}, ${second.id})
      ORDER BY m.sent_at, m.created_at
    `;
    expect(stored).toEqual([
      { organization_id: ORG_2, content: "Hola", name: "Fátima Giménez" },
      {
        organization_id: ORG_2,
        content: "¿Aceptan usado?",
        name: "Fátima Giménez",
      },
    ]);

    // El proveedor reintenta el mismo lote: todo es duplicate.
    const retry = await handleWhatsAppWebhook(signedRequest(payload));
    expect(await retry.json()).toMatchObject({ recorded: 0, duplicate: 2 });
    expect(
      await db.admin`SELECT 1 FROM public.messages WHERE external_id IN (${first.id}, ${second.id})`,
    ).toHaveLength(2);
  });

  it("un POST sin firma válida no escribe nada", async () => {
    const before = await countAll();
    const payload = textWebhook([textMessage()], { lineId: LINE_1 });
    const response = await handleWhatsAppWebhook(
      signedRequest(payload, { secret: "another-secret-another-secret-xx" }),
    );
    expect(response.status).toBe(401);
    expect(await countAll()).toEqual(before);
  });

  it("un payload firmado a una línea desconocida responde 200 sin escribir", async () => {
    const before = await countAll();
    const response = await handleWhatsAppWebhook(
      signedRequest(textWebhook([textMessage()], { lineId: "123456789" })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unknown_line: 1 });
    expect(await countAll()).toEqual(before);
  });
});
