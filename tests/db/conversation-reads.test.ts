import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  recordConversationRead,
  selectReadCursor,
  selectUnreadCounts,
} from "@/db/queries/conversation-reads";
import { getInbox } from "@/db/queries/conversations";
import { ingestInboundMessage } from "@/db/queries/ingest-whatsapp-message";
import { recordOutboundMessage } from "@/db/queries/outbound-message";
import { withIngestion, withTenant, type TenantContext } from "@/db/tenant";
import type { InboxItem, InboxThread } from "@/domains/conversations/inbox";
import { markConversationRead } from "@/lib/conversations/read";

import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool } from "./support/runtime";
import {
  ORG_1,
  ORG_2,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
} from "./support/tenants";

/*
 * Leído interno de la bandeja (Hito 12B, DEC-044 §2) contra PostgreSQL 17
 * con las migraciones aplicadas, por el boundary real (withTenant(),
 * conectado como app_runtime que asume authenticated con los claims del
 * miembro):
 *
 *   recordConversationRead() → private.mark_conversation_read() (SECURITY
 *   DEFINER): usuario → membership activa → conversación abierta de la
 *   organización y mensaje de ella → cursor = created_at, con GREATEST
 *   selectUnreadCounts() / selectReadCursor() → getInbox(): el contador de
 *   la lista y el separador del historial
 *
 * Prueba el cursor por miembro (que uno lea no marca a otro), que solo
 * avanza, que responder es leer, que solo cuentan los entrantes, que un
 * mensaje que llegó después (o uno viejo entregado tarde) sigue sin leer,
 * que nadie escribe los cursores directo ni lee los ajenos (RLS), que la
 * identidad sin claims y un ex miembro no marcan, y la Server Action de
 * punta a punta.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 ·
 * C: seller de ORG_1, admin de ORG_3 y seller inactivo de ORG_2 · D: solo
 * una membership inactiva de ORG_1.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireTenant: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
  resolveRequestTenant: vi.fn(),
}));

const LINE_1 = "300000000000001";
const LINE_2 = "300000000000002";

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
    ])}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(tenantContext(USER_C, ORG_1));
});

function signedInAs(ctx: TenantContext): void {
  mocks.requireTenant.mockResolvedValue(ctx);
}

let sequence = 0;

type Conversation = Readonly<{ conversationId: string; phone: string }>;

/** Un mensaje entrante por la ingesta; abre la conversación si hace falta. */
async function inbound(
  lineId: string,
  phone: string,
  sentAt = new Date("2026-11-01T12:00:00Z"),
): Promise<Readonly<{ conversationId: string; messageId: string }>> {
  sequence += 1;
  const result = await ingestInboundMessage({
    lineId,
    externalId: `wamid.READ${String(sequence).padStart(8, "0")}`,
    phone,
    phoneNormalized: phone,
    contactName: "Cliente de prueba",
    content: `Hola ${sequence}`,
    preview: `Hola ${sequence}`,
    sentAt,
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return {
    conversationId: result.conversationId,
    messageId: result.messageId,
  };
}

/** Una conversación nueva con `count` entrantes; devuelve sus ids en orden. */
async function conversationWith(
  lineId: string,
  count: number,
): Promise<Conversation & Readonly<{ messageIds: string[] }>> {
  sequence += 1;
  const phone = `+595983${String(100_000 + sequence).padStart(6, "0")}`;
  const messageIds: string[] = [];
  let conversationId = "";
  for (let i = 0; i < count; i += 1) {
    const message = await inbound(
      lineId,
      phone,
      new Date(Date.UTC(2026, 10, 1, 12, i)),
    );
    conversationId = message.conversationId;
    messageIds.push(message.messageId);
  }
  return { conversationId, phone, messageIds };
}

/** Una respuesta de `ctx` en la conversación, como la registra el envío. */
async function reply(ctx: TenantContext, conversationId: string) {
  sequence += 1;
  const content = `Respuesta ${sequence}`;
  const result = await recordOutboundMessage(ctx, {
    conversationId,
    externalId: `wamid.OUT${String(sequence).padStart(8, "0")}${randomUUID().slice(0, 8)}`,
    content,
    preview: content,
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return result.messageId;
}

type ReadRow = {
  organization_id: string;
  conversation_id: string;
  user_id: string;
  read_up_to_is_message: boolean;
  updated_at: Date;
};

/** Los cursores de una conversación, leídos como dueño. */
async function cursorRows(conversationId: string): Promise<ReadRow[]> {
  return db.admin<ReadRow[]>`
    SELECT r.organization_id, r.conversation_id, r.user_id, r.updated_at,
      r.read_up_to = (
        SELECT m.created_at FROM public.messages m
        WHERE m.conversation_id = r.conversation_id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ) AS read_up_to_is_message
    FROM public.conversation_reads r
    WHERE r.conversation_id = ${conversationId}
    ORDER BY r.user_id
  `;
}

/** ¿El cursor de `userId` es exactamente el created_at de `messageId`? */
async function cursorIsAt(
  conversationId: string,
  userId: string,
  messageId: string,
): Promise<boolean> {
  const [row] = await db.admin<{ at: boolean | null }[]>`
    SELECT (
      SELECT r.read_up_to = m.created_at
      FROM public.conversation_reads r, public.messages m
      WHERE r.conversation_id = ${conversationId}
        AND r.user_id = ${userId}
        AND m.id = ${messageId}
    ) AS at
  `;
  return row?.at === true;
}

async function readCount(): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.conversation_reads
  `;
  return row!.count;
}

/** La conversación en la lista de quien mira. */
async function listed(
  ctx: TenantContext,
  conversationId: string,
): Promise<InboxItem> {
  signedInAs(ctx);
  const inbox = await getInbox(undefined);
  const item = inbox.conversations.find((c) => c.id === conversationId);
  if (!item) throw new Error("conversation not listed");
  return item;
}

/** El historial de la conversación para quien mira. */
async function thread(
  ctx: TenantContext,
  conversationId: string,
): Promise<Extract<InboxThread, { kind: "found" }>> {
  signedInAs(ctx);
  const inbox = await getInbox(conversationId);
  if (inbox.thread.kind !== "found") throw new Error("thread not found");
  return inbox.thread;
}

const C = () => tenantContext(USER_C, ORG_1);
const A = () => tenantContext(USER_A, ORG_1);

describe("marcar visto: private.mark_conversation_read() (DEC-044 §2)", () => {
  it("el cursor es el created_at del mensaje marcado (el reloj de la base), solo del miembro que marca", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 2);

    const outcome = await recordConversationRead(C(), {
      conversationId,
      upToMessageId: messageIds[0]!,
    });

    expect(outcome).toMatchObject({ outcome: "marked" });
    expect(await cursorIsAt(conversationId, USER_C, messageIds[0]!)).toBe(true);
    const rows = await cursorRows(conversationId);
    expect(rows.map((row) => [row.organization_id, row.user_id])).toEqual([
      [ORG_1, USER_C],
    ]);
  });

  it("solo avanza: un mensaje más viejo, o el mismo otra vez, no escribe nada", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 2);
    expect(
      await recordConversationRead(C(), {
        conversationId,
        upToMessageId: messageIds[1]!,
      }),
    ).toMatchObject({ outcome: "marked" });
    const [before] = await cursorRows(conversationId);

    for (const messageId of [messageIds[0]!, messageIds[1]!]) {
      expect(
        await recordConversationRead(C(), {
          conversationId,
          upToMessageId: messageId,
        }),
      ).toMatchObject({ outcome: "unchanged" });
    }

    const [after] = await cursorRows(conversationId);
    expect(after).toEqual(before);
    expect(after?.read_up_to_is_message).toBe(true);
  });

  it("dos marcas simultáneas del mismo miembro dejan el cursor en el más nuevo", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 3);

    await Promise.all(
      [messageIds[2]!, messageIds[0]!, messageIds[1]!].map((upToMessageId) =>
        recordConversationRead(C(), { conversationId, upToMessageId }),
      ),
    );

    expect(await cursorIsAt(conversationId, USER_C, messageIds[2]!)).toBe(true);
    expect(await cursorRows(conversationId)).toHaveLength(1);
  });

  it("not_found sin distinguir: conversación de otra organización, cerrada o inexistente, o un mensaje de otra conversación; nada se escribe", async () => {
    const foreign = await conversationWith(LINE_2, 1);
    const closed = await conversationWith(LINE_1, 1);
    await db.admin`
      UPDATE public.conversations SET status = 'closed'
      WHERE id = ${closed.conversationId}
    `;
    const mine = await conversationWith(LINE_1, 1);
    const other = await conversationWith(LINE_1, 1);
    const before = await readCount();

    for (const request of [
      {
        conversationId: foreign.conversationId,
        upToMessageId: foreign.messageIds[0]!,
      },
      {
        conversationId: closed.conversationId,
        upToMessageId: closed.messageIds[0]!,
      },
      { conversationId: randomUUID(), upToMessageId: mine.messageIds[0]! },
      {
        conversationId: mine.conversationId,
        upToMessageId: other.messageIds[0]!,
      },
      { conversationId: mine.conversationId, upToMessageId: randomUUID() },
    ]) {
      expect(await recordConversationRead(C(), request)).toEqual({
        outcome: "not_found",
      });
    }
    expect(await readCount()).toBe(before);
  });

  it("exige un miembro activo: la identidad sin claims (read_requires_user) y un ex miembro (read_not_member) no marcan", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 1);
    const before = await readCount();

    await expect(
      withIngestion((tx) =>
        tx.execute(
          sql`SELECT * FROM private.mark_conversation_read(${ORG_1}::uuid, ${conversationId}::uuid, ${messageIds[0]!}::uuid)`,
        ),
      ),
    ).rejects.toMatchObject({
      cause: {
        code: "42501",
        message: expect.stringContaining("read_requires_user"),
      },
    });

    // D tiene solo una membership inactiva en ORG_1; C, una inactiva en
    // ORG_2.
    for (const ctx of [
      tenantContext(USER_D, ORG_1),
      tenantContext(USER_C, ORG_2),
    ]) {
      await expect(
        recordConversationRead(ctx, {
          conversationId,
          upToMessageId: messageIds[0]!,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "42501",
          message: expect.stringContaining("read_not_member"),
        },
      });
    }
    expect(await readCount()).toBe(before);
  });

  it("RLS: cada miembro lee solo sus cursores y nadie de la app los escribe directo", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 1);
    const request = { conversationId, upToMessageId: messageIds[0]! };
    await recordConversationRead(C(), request);
    await recordConversationRead(A(), request);
    expect(await cursorRows(conversationId)).toHaveLength(2);

    for (const [ctx, userId] of [
      [C(), USER_C],
      [A(), USER_A],
    ] as const) {
      const visible = await withTenant(ctx, (tx) =>
        tx.execute<{ user_id: string }>(
          sql`SELECT user_id FROM public.conversation_reads WHERE conversation_id = ${conversationId}`,
        ),
      );
      expect([...visible].map((row) => row.user_id)).toEqual([userId]);
    }
    // B, de otra organización, no ve nada de ORG_1.
    const foreign = await withTenant(tenantContext(USER_B, ORG_2), (tx) =>
      tx.execute(
        sql`SELECT 1 FROM public.conversation_reads WHERE conversation_id = ${conversationId}`,
      ),
    );
    expect([...foreign]).toEqual([]);

    for (const statement of [
      sql`INSERT INTO public.conversation_reads (organization_id, conversation_id, user_id, read_up_to) VALUES (${ORG_1}::uuid, ${conversationId}::uuid, ${USER_C}::uuid, now())`,
      sql`UPDATE public.conversation_reads SET read_up_to = now() + interval '1 day' WHERE conversation_id = ${conversationId}`,
      sql`DELETE FROM public.conversation_reads WHERE conversation_id = ${conversationId}`,
    ]) {
      await expect(
        withTenant(C(), (tx) => tx.execute(statement)),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    expect(await cursorIsAt(conversationId, USER_C, messageIds[0]!)).toBe(true);
    expect(await cursorRows(conversationId)).toHaveLength(2);
  });
});

describe("no leídos de la bandeja: getInbox() (DEC-044 §2)", () => {
  it("sin cursor ni respuesta propia, todo entrante está sin leer; lo que envía el equipo nunca", async () => {
    const { conversationId } = await conversationWith(LINE_1, 2);
    await reply(A(), conversationId);

    // C no respondió ni marcó: los dos entrantes. La respuesta de A no
    // cuenta para C.
    expect((await listed(C(), conversationId)).unread).toEqual({
      kind: "unread",
      count: 2,
      label: "2",
      description: "2 mensajes sin leer",
    });
    // A respondió después de los dos: responder es leer.
    expect((await listed(A(), conversationId)).unread).toEqual({
      kind: "read",
    });
  });

  it("marcar visto deja la conversación en cero para quien marca, no para otro miembro", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 3);
    const before = await thread(C(), conversationId);
    expect(before.read).toEqual({
      unread: 3,
      firstUnreadId: messageIds[0],
      upToMessageId: messageIds[2],
    });

    await recordConversationRead(C(), {
      conversationId,
      upToMessageId: before.read.upToMessageId!,
    });

    expect((await listed(C(), conversationId)).unread).toEqual({
      kind: "read",
    });
    expect((await thread(C(), conversationId)).read).toEqual({
      unread: 0,
      firstUnreadId: null,
      upToMessageId: messageIds[2],
    });
    expect((await listed(A(), conversationId)).unread).toMatchObject({
      kind: "unread",
      count: 3,
    });
  });

  it("un entrante registrado después del cursor sigue sin leer, también uno viejo que el proveedor entregó tarde", async () => {
    const { conversationId, phone, messageIds } = await conversationWith(
      LINE_1,
      2,
    );
    await recordConversationRead(C(), {
      conversationId,
      upToMessageId: messageIds[1]!,
    });

    // Enviado antes que todo lo marcado, registrado después.
    const late = await inbound(LINE_1, phone, new Date("2026-11-01T08:00:00Z"));

    expect((await listed(C(), conversationId)).unread).toMatchObject({
      kind: "unread",
      count: 1,
    });
    const { read, sections } = await thread(C(), conversationId);
    // El separador va antes del tardío, que el chat muestra primero (por
    // sent_at); marcar visto llega hasta él (el registrado más tarde).
    expect(sections[0]?.bubbles[0]?.id).toBe(late.messageId);
    expect(read).toEqual({
      unread: 1,
      firstUnreadId: late.messageId,
      upToMessageId: late.messageId,
    });
  });

  it("el contador de la lista y el historial cuentan igual: se compara al milisegundo", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 1);
    // Dos entrantes en el mismo milisegundo, registrados después del de la
    // ingesta, y el cursor en el primero de los dos.
    for (const [id, at, wamid] of [
      [randomUUID(), "2030-01-01T15:00:00.123100Z", "wamid.MS1"],
      [randomUUID(), "2030-01-01T15:00:00.123900Z", "wamid.MS2"],
    ] as const) {
      await db.admin`
        INSERT INTO public.messages (id, organization_id, contact_id,
          conversation_id, channel, direction, content, external_id, sent_at,
          created_at)
        SELECT ${id}, cv.organization_id, cv.contact_id, cv.id, 'whatsapp',
          'inbound', 'Mismo milisegundo', ${wamid}, ${at}::text::timestamptz,
          ${at}::text::timestamptz
        FROM public.conversations cv WHERE cv.id = ${conversationId}
      `;
    }
    await db.admin`
      INSERT INTO public.conversation_reads (organization_id, conversation_id,
        user_id, read_up_to)
      VALUES (${ORG_1}, ${conversationId}, ${USER_C},
        '2030-01-01T15:00:00.123100Z'::text::timestamptz)
    `;

    // La base guarda el instante completo: a nivel de microsegundos el
    // segundo sería posterior. Al milisegundo (lo que ve el dominio) no.
    expect((await listed(C(), conversationId)).unread).toEqual({
      kind: "read",
    });
    expect((await thread(C(), conversationId)).read).toMatchObject({
      unread: 0,
      firstUnreadId: null,
    });
    expect(messageIds).toHaveLength(1);
  });

  it("los contadores y el cursor se leen solo de la organización activa", async () => {
    const mine = await conversationWith(LINE_1, 1);
    const foreign = await conversationWith(LINE_2, 2);
    await recordConversationRead(tenantContext(USER_B, ORG_2), {
      conversationId: foreign.conversationId,
      upToMessageId: foreign.messageIds[0]!,
    });

    const counts = await withTenant(C(), (tx) =>
      selectUnreadCounts(tx, C(), [
        mine.conversationId,
        foreign.conversationId,
      ]),
    );
    expect(counts.get(mine.conversationId)).toBe(1);
    expect(counts.has(foreign.conversationId)).toBe(false);

    // El cursor de B en ORG_2 no aparece ni con el id de la conversación.
    const cursor = await withTenant(C(), (tx) =>
      selectReadCursor(tx, C(), foreign.conversationId),
    );
    expect(cursor).toEqual({ readUpTo: null, lastOwnReplyAt: null });
  });
});

describe("Server Action markConversationRead() de punta a punta", () => {
  it("requireTenant() → marca → revalida /conversations; repetirlo no escribe ni revalida", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 2);
    const request = { conversationId, upToMessageId: messageIds[1]! };

    expect(await markConversationRead(request)).toEqual({ status: "marked" });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/conversations",
    );
    expect(await cursorIsAt(conversationId, USER_C, messageIds[1]!)).toBe(true);

    mocks.revalidatePath.mockClear();
    expect(await markConversationRead(request)).toEqual({
      status: "unchanged",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un pedido inválido, de otra organización o con un mensaje ajeno se ignora sin escribir", async () => {
    const mine = await conversationWith(LINE_1, 1);
    const foreign = await conversationWith(LINE_2, 1);
    const before = await readCount();

    for (const input of [
      { conversationId: "no-es-un-uuid", upToMessageId: mine.messageIds[0] },
      {
        conversationId: foreign.conversationId,
        upToMessageId: foreign.messageIds[0],
      },
      {
        conversationId: mine.conversationId,
        upToMessageId: foreign.messageIds[0],
      },
    ]) {
      expect(await markConversationRead(input)).toEqual({ status: "ignored" });
    }
    expect(await readCount()).toBe(before);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un ex miembro no marca: la acción falla cerrada y no expone la base", async () => {
    const { conversationId, messageIds } = await conversationWith(LINE_1, 1);
    signedInAs(tenantContext(USER_D, ORG_1));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await markConversationRead({
        conversationId,
        upToMessageId: messageIds[0],
      }),
    ).toEqual({ status: "failed" });
    // Solo el tipo, el SQLSTATE y la constraint: nunca la query ni los ids.
    expect(error).toHaveBeenCalledWith("[conversations] mark read failed", {
      name: "Error",
      code: "42501",
      constraint_name: undefined,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(conversationId);
    error.mockRestore();
    expect(await cursorRows(conversationId)).toEqual([]);
  });
});
