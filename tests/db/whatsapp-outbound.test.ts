import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getInbox } from "@/db/queries/conversations";
import { ingestInboundMessage } from "@/db/queries/ingest-whatsapp-message";
import {
  recordOutboundMessage,
  selectSendTarget,
} from "@/db/queries/outbound-message";
import { conversations, messages, whatsappLines } from "@/db/schema";
import { withIngestion, withTenant, type TenantContext } from "@/db/tenant";

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
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
} from "./support/tenants";

/*
 * Envío de mensajes de WhatsApp desde la bandeja (Hito 8, DEC-040) contra
 * PostgreSQL 17 con las migraciones aplicadas, por el boundary real
 * (withTenant(), conectado como app_runtime que asume authenticated con los
 * claims del miembro):
 *
 *   selectSendTarget() → la conversación abierta en la organización activa
 *   y su línea · recordOutboundMessage() →
 *   private.record_outbound_whatsapp_message() (SECURITY DEFINER): miembro
 *   activo → conversación abierta → oportunidad abierta única → mensaje
 *   (idempotente) → último mensaje de la conversación → trigger de actividad
 *
 * Prueba el registro, que un vendedor no puede enviar ni registrar en una
 * conversación de otro tenant (ni con un contexto falsificado), que la
 * identidad sin claims no envía, que un miembro no escribe conversaciones ni
 * mensajes de conversación por sí mismo, la lectura de las líneas y la de
 * la bandeja (getInbox()), filtrada por la organización activa.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 ·
 * C: seller de ORG_1, admin de ORG_3 y seller inactivo de ORG_2.
 * Líneas: LINE_1 → ORG_1 · LINE_2 → ORG_2 · LINE_OFF → ORG_1, inactiva.
 * ORG_3 empieza sin líneas.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  revalidatePath: vi.fn(),
  resolveRequestTenant: vi.fn(),
  requireTenant: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/session", () => ({
  resolveRequestTenant: mocks.resolveRequestTenant,
  requireTenant: mocks.requireTenant,
}));

const LINE_1 = "200000000000001";
const LINE_2 = "200000000000002";
const LINE_OFF = "200000000000003";
const API_TOKEN = "test-whatsapp-api-token-0123456789abcdef";

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
  vi.stubEnv("WHATSAPP_API_TOKEN", API_TOKEN);
  vi.stubGlobal("fetch", mocks.fetch);
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(tenantContext(USER_C, ORG_1));
});

let sequence = 0;

function next(): number {
  sequence += 1;
  return sequence;
}

type Conversation = Readonly<{
  organizationId: string;
  conversationId: string;
  contactId: string;
  phone: string;
}>;

/** Una conversación abierta nueva, por la ingesta de un mensaje entrante. */
async function conversationOn(
  lineId: string,
  sentAt = new Date("2026-10-29T12:00:00Z"),
): Promise<Conversation> {
  const n = next();
  const phone = `+595982${String(100_000 + n).padStart(6, "0")}`;
  const result = await ingestInboundMessage({
    lineId,
    externalId: `wamid.IN${String(n).padStart(8, "0")}`,
    phone,
    phoneNormalized: phone,
    contactName: "Cliente de prueba",
    content: `Hola ${n}`,
    preview: `Hola ${n}`,
    sentAt,
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return {
    organizationId: result.organizationId,
    conversationId: result.conversationId,
    contactId: result.contactId,
    phone,
  };
}

/** Un mensaje enviado con un id de Meta propio del caso. */
function outbound(conversationId: string, content = `Respuesta ${next()}`) {
  return {
    conversationId,
    externalId: `wamid.OUT${String(sequence).padStart(8, "0")}${randomUUID().slice(0, 8)}`,
    content,
    preview: content,
  };
}

type Row = Record<string, unknown>;

async function messageRows(conversationId: string): Promise<Row[]> {
  return db.admin<Row[]>`
    SELECT * FROM public.messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at, id
  `;
}

async function conversationRow(conversationId: string): Promise<Row> {
  const [row] = await db.admin<Row[]>`
    SELECT * FROM public.conversations WHERE id = ${conversationId}
  `;
  return row!;
}

async function messageCount(): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.messages
  `;
  return row!.count;
}

const DAY = 86_400_000;

/** Una oportunidad abierta del contacto, con actividad hace un día. */
async function openOpportunity(
  organizationId: string,
  contactId: string,
): Promise<string> {
  const id = randomUUID();
  const at = new Date(Date.now() - DAY);
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage: "qualifying",
      source: "whatsapp",
      ...closureColumns("qualifying"),
      last_activity_at: at,
      created_at: at,
      updated_at: at,
    })}
  `;
  return id;
}

function signedInAs(ctx: TenantContext): void {
  mocks.resolveRequestTenant.mockResolvedValue({
    kind: "resolved",
    context: ctx,
  });
  mocks.requireTenant.mockResolvedValue(ctx);
}

describe("registro por la función (DEC-040 §6)", () => {
  it("registra el enviado en la conversación, con autor y reloj de la base, y mueve el último mensaje", async () => {
    const conversation = await conversationOn(LINE_1);
    const ctx = tenantContext(USER_C, ORG_1);
    const write = outbound(
      conversation.conversationId,
      "Sí, sigue\ndisponible",
    );

    const result = await recordOutboundMessage(ctx, {
      ...write,
      preview: "Sí, sigue disponible",
    });

    expect(result).toMatchObject({ outcome: "recorded", opportunityId: null });
    if (result.outcome !== "recorded") throw new Error("not recorded");
    const [, sent] = await messageRows(conversation.conversationId);
    expect(sent).toMatchObject({
      id: result.messageId,
      organization_id: ORG_1,
      contact_id: conversation.contactId,
      conversation_id: conversation.conversationId,
      opportunity_id: null,
      channel: "whatsapp",
      direction: "outbound",
      content: "Sí, sigue\ndisponible",
      recorded_by: USER_C,
      external_id: write.externalId,
    });
    // sent_at y created_at son el reloj de la base (la misma transacción).
    expect(sent!.sent_at).toEqual(sent!.created_at);
    expect(
      Math.abs((sent!.sent_at as Date).getTime() - Date.now()),
    ).toBeLessThan(60_000);
    expect(await conversationRow(conversation.conversationId)).toMatchObject({
      last_message_at: sent!.sent_at,
      last_message_preview: "Sí, sigue disponible",
    });
  });

  it("se asocia a la oportunidad abierta única del contacto y mueve su recencia", async () => {
    const conversation = await conversationOn(LINE_1);
    const opportunityId = await openOpportunity(ORG_1, conversation.contactId);
    const [before] = await db.admin<{ at: Date }[]>`
      SELECT last_activity_at AS at FROM public.opportunities
      WHERE id = ${opportunityId}
    `;

    const result = await recordOutboundMessage(
      tenantContext(USER_A, ORG_1),
      outbound(conversation.conversationId),
    );

    expect(result).toMatchObject({ outcome: "recorded", opportunityId });
    const [after] = await db.admin<{ at: Date }[]>`
      SELECT last_activity_at AS at FROM public.opportunities
      WHERE id = ${opportunityId}
    `;
    expect(after!.at.getTime()).toBeGreaterThan(before!.at.getTime());
  });

  it("el mismo id de Meta dos veces es duplicate: una sola fila", async () => {
    const conversation = await conversationOn(LINE_1);
    const ctx = tenantContext(USER_C, ORG_1);
    const write = outbound(conversation.conversationId);

    const first = await recordOutboundMessage(ctx, write);
    const again = await recordOutboundMessage(ctx, write);

    if (first.outcome !== "recorded") throw new Error("not recorded");
    expect(again).toEqual({ ...first, outcome: "duplicate" });
    const stored = await db.admin`
      SELECT id FROM public.messages WHERE external_id = ${write.externalId}
    `;
    expect(stored).toHaveLength(1);
  });

  it("no pisa un último mensaje más nuevo que el envío", async () => {
    const future = new Date(Date.now() + DAY);
    const conversation = await conversationOn(LINE_1, future);
    const { last_message_preview: preview } = await conversationRow(
      conversation.conversationId,
    );

    const result = await recordOutboundMessage(
      tenantContext(USER_C, ORG_1),
      outbound(conversation.conversationId),
    );

    expect(result.outcome).toBe("recorded");
    expect(await conversationRow(conversation.conversationId)).toMatchObject({
      last_message_at: future,
      last_message_preview: preview,
    });
  });

  it("una conversación cerrada es not_found y no escribe nada", async () => {
    const conversation = await conversationOn(LINE_1);
    await db.admin`
      UPDATE public.conversations SET status = 'closed'
      WHERE id = ${conversation.conversationId}
    `;
    const before = await messageCount();

    expect(
      await recordOutboundMessage(
        tenantContext(USER_C, ORG_1),
        outbound(conversation.conversationId),
      ),
    ).toEqual({ outcome: "not_found" });
    expect(
      await selectSendTarget(
        tenantContext(USER_C, ORG_1),
        conversation.conversationId,
      ),
    ).toEqual({ outcome: "not_found" });
    expect(await messageCount()).toBe(before);
  });

  it("la función exige todos los argumentos (22004)", async () => {
    const conversation = await conversationOn(LINE_1);
    await expect(
      withTenant(tenantContext(USER_C, ORG_1), (tx) =>
        tx.execute(
          sql`SELECT * FROM private.record_outbound_whatsapp_message(${ORG_1}::uuid, ${conversation.conversationId}::uuid, NULL, 'Hola', 'Hola')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "22004" } });
  });
});

describe("aislamiento de tenant (DEC-040 §3)", () => {
  it("un vendedor de ORG_1 no ve ni registra en una conversación de ORG_2: not_found y nada cambia", async () => {
    const foreign = await conversationOn(LINE_2);
    const before = await conversationRow(foreign.conversationId);
    const count = await messageCount();
    const seller = tenantContext(USER_C, ORG_1);

    expect(await selectSendTarget(seller, foreign.conversationId)).toEqual({
      outcome: "not_found",
    });
    expect(
      await recordOutboundMessage(seller, outbound(foreign.conversationId)),
    ).toEqual({ outcome: "not_found" });

    expect(await messageCount()).toBe(count);
    expect(await conversationRow(foreign.conversationId)).toEqual(before);
  });

  it("con un contexto falsificado (membership inactiva en ORG_2): la lectura no ve nada y la función rechaza con 42501", async () => {
    const foreign = await conversationOn(LINE_2);
    const count = await messageCount();
    // C tiene una membership inactiva en ORG_2: Tenant Resolution nunca
    // emitiría este contexto. RLS y la función igual lo contienen.
    const forged = tenantContext(USER_C, ORG_2);

    expect(await selectSendTarget(forged, foreign.conversationId)).toEqual({
      outcome: "not_found",
    });
    await expect(
      recordOutboundMessage(forged, outbound(foreign.conversationId)),
    ).rejects.toMatchObject({
      cause: {
        code: "42501",
        message: expect.stringMatching(/outbound_not_member/),
      },
    });
    expect(await messageCount()).toBe(count);
  });

  it("la función rechaza una organización ajena aunque la conversación sea de ella (42501)", async () => {
    const foreign = await conversationOn(LINE_2);
    const count = await messageCount();
    for (const user of [USER_A, USER_C]) {
      await expect(
        withTenant(tenantContext(user, ORG_1), (tx) =>
          tx.execute(
            sql`SELECT * FROM private.record_outbound_whatsapp_message(${ORG_2}::uuid, ${foreign.conversationId}::uuid, ${`wamid.X${randomUUID()}`}, 'Hola', 'Hola')`,
          ),
        ),
      ).rejects.toMatchObject({
        cause: {
          code: "42501",
          message: expect.stringMatching(/outbound_not_member/),
        },
      });
    }
    expect(await messageCount()).toBe(count);
  });

  it("con la organización activa y una conversación de otra, la función responde not_found", async () => {
    const own = await conversationOn(LINE_1);
    const count = await messageCount();
    // B es admin de ORG_2 y pide registrar en la conversación de ORG_1.
    expect(
      await recordOutboundMessage(
        tenantContext(USER_B, ORG_2),
        outbound(own.conversationId),
      ),
    ).toEqual({ outcome: "not_found" });
    expect(await messageCount()).toBe(count);
  });

  it("la identidad de la ingesta (sin claims) no puede enviar (42501)", async () => {
    const conversation = await conversationOn(LINE_1);
    await expect(
      withIngestion((tx) =>
        tx.execute(
          sql`SELECT * FROM private.record_outbound_whatsapp_message(${ORG_1}::uuid, ${conversation.conversationId}::uuid, 'wamid.SYSTEM', 'Hola', 'Hola')`,
        ),
      ),
    ).rejects.toMatchObject({
      cause: {
        code: "42501",
        message: expect.stringMatching(/outbound_requires_user/),
      },
    });
  });

  it("app_runtime sin asumir authenticated no puede ejecutarla (42501)", async () => {
    const conversation = await conversationOn(LINE_1);
    await expect(
      runtimePool()`SELECT * FROM private.record_outbound_whatsapp_message(${ORG_1}::uuid, ${conversation.conversationId}::uuid, 'wamid.RUNTIME', 'Hola', 'Hola')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("un miembro no escribe por sí mismo un mensaje de conversación ni edita la conversación", async () => {
    const conversation = await conversationOn(LINE_1);
    const ctx = tenantContext(USER_C, ORG_1);
    const before = await conversationRow(conversation.conversationId);
    const count = await messageCount();

    // La forma de un enviado, pero sin la función: la policy de alta exige
    // conversation_id IS NULL.
    await expect(
      withTenant(ctx, (tx) =>
        tx.insert(messages).values({
          organizationId: ORG_1,
          contactId: conversation.contactId,
          conversationId: conversation.conversationId,
          channel: "whatsapp",
          direction: "outbound",
          content: "Falso",
          recordedBy: USER_C,
          externalId: `wamid.FORGED${randomUUID()}`,
          sentAt: sql`now()`,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withTenant(ctx, (tx) =>
        tx
          .update(conversations)
          .set({ lastMessagePreview: "Falso", lastMessageAt: new Date() })
          .where(
            and(
              eq(conversations.organizationId, ORG_1),
              eq(conversations.id, conversation.conversationId),
            ),
          ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });

    expect(await messageCount()).toBe(count);
    expect(await conversationRow(conversation.conversationId)).toEqual(before);
  });

  it("cada miembro lee solo las líneas de su organización y no las escribe", async () => {
    const seen = async (ctx: TenantContext) =>
      (
        await withTenant(ctx, (tx) =>
          tx
            .select({ id: whatsappLines.phoneNumberId })
            .from(whatsappLines)
            .orderBy(whatsappLines.phoneNumberId),
        )
      ).map((line) => line.id);

    expect(await seen(tenantContext(USER_A, ORG_1))).toEqual([
      LINE_1,
      LINE_OFF,
    ]);
    expect(await seen(tenantContext(USER_B, ORG_2))).toEqual([LINE_2]);
    // Sin claims, RLS no deja ver ninguna.
    expect(
      await withIngestion((tx) => tx.select().from(whatsappLines)),
    ).toEqual([]);

    const admin = tenantContext(USER_A, ORG_1);
    for (const run of [
      () =>
        withTenant(admin, (tx) =>
          tx.insert(whatsappLines).values({
            organizationId: ORG_1,
            phoneNumberId: "299999999999999",
          }),
        ),
      () =>
        withTenant(admin, (tx) =>
          tx
            .update(whatsappLines)
            .set({ active: false })
            .where(eq(whatsappLines.phoneNumberId, LINE_1)),
        ),
      () =>
        withTenant(admin, (tx) =>
          tx
            .delete(whatsappLines)
            .where(eq(whatsappLines.phoneNumberId, LINE_1)),
        ),
    ]) {
      await expect(run()).rejects.toMatchObject({ cause: { code: "42501" } });
    }
  });

  it("el CHECK de origen exige autor en un saliente y no lo admite en un entrante ingerido", async () => {
    const conversation = await conversationOn(LINE_1);
    const base = {
      organization_id: ORG_1,
      contact_id: conversation.contactId,
      conversation_id: conversation.conversationId,
      channel: "whatsapp",
      content: "Hola",
      sent_at: new Date(),
    };
    for (const row of [
      { ...base, direction: "outbound", recorded_by: null },
      { ...base, direction: "inbound", recorded_by: USER_A },
      { ...base, direction: "outbound", recorded_by: USER_A, channel: "email" },
    ]) {
      await expect(
        db.admin`
          INSERT INTO public.messages ${db.admin({
            ...row,
            external_id: `wamid.CHECK${randomUUID()}`,
          })}
        `,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "messages_source_check",
      });
    }
  });
});

describe("bandeja: getInbox() (DEC-040 §1)", () => {
  it("lista solo las conversaciones abiertas de la organización activa, de la más reciente a la más vieja", async () => {
    const older = await conversationOn(
      LINE_1,
      new Date("2026-10-29T10:00:00Z"),
    );
    const newer = await conversationOn(
      LINE_1,
      new Date("2026-10-29T11:00:00Z"),
    );
    const closed = await conversationOn(LINE_1);
    await db.admin`
      UPDATE public.conversations SET status = 'closed'
      WHERE id = ${closed.conversationId}
    `;
    const foreign = await conversationOn(LINE_2);

    const inbox = await getInbox(undefined);

    const ids = inbox.conversations.map((item) => item.id);
    expect(ids).toContain(older.conversationId);
    expect(ids).toContain(newer.conversationId);
    expect(ids.indexOf(newer.conversationId)).toBeLessThan(
      ids.indexOf(older.conversationId),
    );
    expect(ids).not.toContain(closed.conversationId);
    expect(ids).not.toContain(foreign.conversationId);
    const [open] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.conversations
      WHERE organization_id = ${ORG_1} AND status = 'open'
    `;
    expect(inbox.total).toBe(open!.count);
    expect(inbox.thread).toEqual({ kind: "none" });
    expect(inbox.selectedId).toBeNull();
    // Ordenada por last_message_at descendente.
    const times = await db.admin<{ id: string }[]>`
      SELECT id FROM public.conversations
      WHERE organization_id = ${ORG_1} AND status = 'open'
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
    `;
    expect(ids).toEqual(times.map((row) => row.id));
  });

  it("el historial de la elegida: del más viejo al más nuevo, entrantes y salientes, sin teléfono completo", async () => {
    const conversation = await conversationOn(
      LINE_1,
      new Date("2026-10-29T09:00:00Z"),
    );
    await recordOutboundMessage(tenantContext(USER_C, ORG_1), {
      ...outbound(conversation.conversationId, "Respuesta de C"),
    });
    await recordOutboundMessage(tenantContext(USER_A, ORG_1), {
      ...outbound(conversation.conversationId, "Respuesta de A"),
    });

    const inbox = await getInbox(conversation.conversationId.toUpperCase());

    expect(inbox.selectedId).toBe(conversation.conversationId);
    expect(inbox.thread).toMatchObject({
      kind: "found",
      conversationId: conversation.conversationId,
      contact: { name: "Cliente de prueba", maskedPhone: expect.any(String) },
      total: 3,
    });
    if (inbox.thread.kind !== "found") throw new Error("not found");
    expect(inbox.thread.contact.maskedPhone).not.toBe(conversation.phone);
    expect(
      inbox.thread.messages.map((message) => [
        message.direction,
        message.author,
        message.body,
      ]),
    ).toEqual([
      ["inbound", "Cliente", expect.stringMatching(/^Hola \d+$/)],
      ["outbound", "Vos", "Respuesta de C"],
      ["outbound", "Otro miembro", "Respuesta de A"],
    ]);
    expect(JSON.stringify(inbox)).not.toContain(conversation.phone);
  });

  it.each([
    ["de otra organización", "foreign"],
    ["cerrada", "closed"],
    ["inexistente", "missing"],
    ["con un id inválido", "invalid"],
  ])("una conversación %s es not_found, sin distinguir", async (_, kind) => {
    let selected: string = randomUUID();
    if (kind === "foreign") {
      selected = (await conversationOn(LINE_2)).conversationId;
    }
    if (kind === "closed") {
      selected = (await conversationOn(LINE_1)).conversationId;
      await db.admin`
          UPDATE public.conversations SET status = 'closed'
          WHERE id = ${selected}
        `;
    }
    if (kind === "invalid") selected = "no-es-un-uuid";

    const inbox = await getInbox(selected);

    expect(inbox.thread).toEqual({ kind: "not_found" });
    // Tampoco aparece en la lista: ni de otra organización ni cerrada.
    expect(inbox.conversations.map((item) => item.id)).not.toContain(selected);
  });
});

describe("destino del envío (DEC-040 §4)", () => {
  it("responde desde la línea activa de la organización, al teléfono E.164 del contacto sin el +", async () => {
    const conversation = await conversationOn(LINE_1);
    expect(
      await selectSendTarget(
        tenantContext(USER_C, ORG_1),
        conversation.conversationId,
      ),
    ).toEqual({
      outcome: "ready",
      phoneNumberId: LINE_1,
      to: conversation.phone.slice(1),
    });
  });

  it("sin línea activa, o con varias, es no_line", async () => {
    // Una conversación de ORG_3, que no tiene líneas: la crea el dueño.
    const contactId = randomUUID();
    const conversationId = randomUUID();
    await db.admin`
      INSERT INTO public.contacts (id, organization_id, name, phone, phone_normalized)
      VALUES (${contactId}, ${ORG_3}, 'Cliente ORG_3', '+595983000001', '+595983000001')
    `;
    await db.admin`
      INSERT INTO public.conversations (id, organization_id, contact_id, channel)
      VALUES (${conversationId}, ${ORG_3}, ${contactId}, 'whatsapp')
    `;
    const admin = tenantContext(USER_C, ORG_3);

    expect(await selectSendTarget(admin, conversationId)).toEqual({
      outcome: "no_line",
    });
    await db.admin`
      INSERT INTO public.whatsapp_lines (organization_id, phone_number_id)
      VALUES (${ORG_3}, '200000000000031')
    `;
    expect(await selectSendTarget(admin, conversationId)).toEqual({
      outcome: "ready",
      phoneNumberId: "200000000000031",
      to: "595983000001",
    });
    await db.admin`
      INSERT INTO public.whatsapp_lines (organization_id, phone_number_id)
      VALUES (${ORG_3}, '200000000000032')
    `;
    expect(await selectSendTarget(admin, conversationId)).toEqual({
      outcome: "no_line",
    });
    await db.admin`
      UPDATE public.whatsapp_lines SET active = false
      WHERE organization_id = ${ORG_3}
    `;
    expect(await selectSendTarget(admin, conversationId)).toEqual({
      outcome: "no_line",
    });
  });
});
