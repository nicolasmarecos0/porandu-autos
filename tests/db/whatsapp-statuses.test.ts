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
  ingestDeliveryStatus,
  type DeliveryStatusWrite,
} from "@/db/queries/ingest-whatsapp-status";
import { recordOutboundMessage } from "@/db/queries/outbound-message";
import { messageStatuses } from "@/db/schema";
import { withIngestion, withTenant, type TenantContext } from "@/db/tenant";
import type { DeliveryStatus } from "@/domains/conversations/delivery";
import type { InboxThread } from "@/domains/conversations/inbox";
import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook";

import {
  signedRequest,
  statusWebhook,
  TEST_APP_SECRET,
} from "../unit/support/whatsapp-payload";
import {
  inRolledBackTransaction,
  asRole,
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
  USER_B,
  USER_C,
} from "./support/tenants";

/*
 * Estados de entrega de WhatsApp (Hito 12C, DEC-044 §3) contra PostgreSQL 17
 * con las migraciones aplicadas, por el boundary real (withIngestion(), sin
 * claims; withTenant(), con los del miembro; conectado como app_runtime):
 *
 *   webhook firmado → ingestDeliveryStatus() → withIngestion() →
 *   private.ingest_whatsapp_status() (SECURITY DEFINER): organización de la
 *   línea → el saliente con ese id → INSERT del estado (idempotente)
 *   getInbox() → los estados de cada saliente → el vigente por precedencia
 *
 * Prueba que el tenant sale solo de la línea, que un estado repetido (también
 * simultáneo) deja una sola fila, que un id desconocido, un entrante o el
 * saliente de otra organización no escriben nada, que un estado inferior que
 * llega tarde nunca pisa uno superior en la bandeja, que nadie de la app
 * escribe, edita ni borra estados por sí mismo (append-only, también
 * service_role), que un miembro no puede registrarlos, que cada miembro lee
 * solo los de su organización y el webhook de punta a punta.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 ·
 * C: seller de ORG_1, admin de ORG_3 y seller inactivo de ORG_2.
 * Líneas: LINE_1 → ORG_1 · LINE_2 → ORG_2 · LINE_OFF → ORG_1, inactiva.
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

const LINE_1 = "400000000000001";
const LINE_2 = "400000000000002";
const LINE_OFF = "400000000000003";

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
  // El webhook registra sus conteos: no ensucian la salida de la suite.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

function next(): number {
  sequence += 1;
  return sequence;
}

type Conversation = Readonly<{
  organizationId: string;
  conversationId: string;
  inboundExternalId: string;
}>;

/** Una conversación abierta nueva, por la ingesta de un mensaje entrante. */
async function conversationOn(lineId: string): Promise<Conversation> {
  const n = next();
  const phone = `+595983${String(100_000 + n).padStart(6, "0")}`;
  const inboundExternalId = `wamid.IN12C${String(n).padStart(8, "0")}`;
  const result = await ingestInboundMessage({
    lineId,
    externalId: inboundExternalId,
    phone,
    phoneNormalized: phone,
    contactName: "Cliente de prueba",
    content: `Hola ${n}`,
    preview: `Hola ${n}`,
    sentAt: new Date("2026-11-01T12:00:00Z"),
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return {
    organizationId: result.organizationId,
    conversationId: result.conversationId,
    inboundExternalId,
  };
}

type Sent = Readonly<{ messageId: string; externalId: string }>;

/** Un saliente que Meta aceptó y la función de envío registró (DEC-040 §6). */
async function sent(
  conversation: Conversation,
  ctx: TenantContext = tenantContext(USER_C, ORG_1),
): Promise<Sent> {
  const externalId = `wamid.OUT12C${String(next()).padStart(8, "0")}${randomUUID().slice(0, 8)}`;
  const result = await recordOutboundMessage(ctx, {
    conversationId: conversation.conversationId,
    externalId,
    content: `Respuesta ${sequence}`,
    preview: `Respuesta ${sequence}`,
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return { messageId: result.messageId, externalId };
}

function status(
  externalId: string,
  value: DeliveryStatus,
  overrides: Partial<DeliveryStatusWrite> = {},
): DeliveryStatusWrite {
  return {
    lineId: LINE_1,
    externalId,
    status: value,
    occurredAt: new Date("2026-11-01T12:05:00Z"),
    ...overrides,
  };
}

type Row = Record<string, unknown>;

async function statusRows(messageId: string): Promise<Row[]> {
  return db.admin<Row[]>`
    SELECT organization_id, message_id, status, occurred_at, created_at
    FROM public.message_statuses
    WHERE message_id = ${messageId}
    ORDER BY status
  `;
}

async function statusCount(): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.message_statuses
  `;
  return row!.count;
}

async function messageRow(messageId: string): Promise<Row> {
  const [row] = await db.admin<Row[]>`
    SELECT * FROM public.messages WHERE id = ${messageId}
  `;
  return row!;
}

describe("ingesta de estados por la función (DEC-044 §3.3)", () => {
  it("registra el estado del saliente por la línea de su organización, con el instante del proveedor y el reloj de la base, sin tocar el mensaje", async () => {
    const conversation = await conversationOn(LINE_1);
    const message = await sent(conversation);
    const before = await messageRow(message.messageId);
    const [clock] = await db.admin<{ now: Date }[]>`SELECT now() AS now`;

    const result = await ingestDeliveryStatus(
      status(message.externalId, "delivered"),
    );

    expect(result).toEqual({
      outcome: "recorded",
      organizationId: ORG_1,
      messageId: message.messageId,
    });
    const [row] = await statusRows(message.messageId);
    expect(row).toMatchObject({
      organization_id: ORG_1,
      message_id: message.messageId,
      status: "delivered",
      occurred_at: new Date("2026-11-01T12:05:00Z"),
    });
    // created_at es el reloj de la base, no el del proveedor.
    expect((row!.created_at as Date).getTime()).toBeGreaterThanOrEqual(
      clock!.now.getTime(),
    );
    // C-11: el mensaje sigue igual; el estado vive aparte.
    expect(await messageRow(message.messageId)).toEqual(before);
  });

  it("registra los cuatro estados del contrato, en cualquier orden", async () => {
    const message = await sent(await conversationOn(LINE_1));
    for (const value of ["read", "failed", "sent", "delivered"] as const) {
      expect(
        await ingestDeliveryStatus(status(message.externalId, value)),
      ).toMatchObject({ outcome: "recorded" });
    }
    expect(
      (await statusRows(message.messageId)).map((row) => row.status),
    ).toEqual(["delivered", "failed", "read", "sent"]);
  });

  it("un estado repetido es duplicate: una sola fila, aunque llegue con otro instante", async () => {
    const message = await sent(await conversationOn(LINE_1));
    expect(
      await ingestDeliveryStatus(status(message.externalId, "read")),
    ).toMatchObject({ outcome: "recorded" });
    expect(
      await ingestDeliveryStatus(
        status(message.externalId, "read", {
          occurredAt: new Date("2026-11-01T13:00:00Z"),
        }),
      ),
    ).toEqual({
      outcome: "duplicate",
      organizationId: ORG_1,
      messageId: message.messageId,
    });
    const rows = await statusRows(message.messageId);
    expect(rows).toHaveLength(1);
    // Queda el primero que se registró.
    expect(rows[0]!.occurred_at).toEqual(new Date("2026-11-01T12:05:00Z"));
  });

  it("entregas simultáneas del mismo estado dejan una sola fila (la PK es la autoridad)", async () => {
    const message = await sent(await conversationOn(LINE_1));
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        ingestDeliveryStatus(status(message.externalId, "delivered")),
      ),
    );
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "recorded",
    ]);
    expect(await statusRows(message.messageId)).toHaveLength(1);
  });

  it("un id desconocido, el de un entrante o el de un saliente de otra organización es unknown_message y no escribe nada", async () => {
    const own = await conversationOn(LINE_1);
    const foreign = await sent(
      await conversationOn(LINE_2),
      tenantContext(USER_B, ORG_2),
    );
    const count = await statusCount();

    for (const externalId of [
      "wamid.NEVERSENT",
      own.inboundExternalId,
      // El saliente de ORG_2, pero informado por la línea de ORG_1: el
      // tenant sale de la línea, nunca del id.
      foreign.externalId,
    ]) {
      expect(
        await ingestDeliveryStatus(status(externalId, "read")),
        externalId,
      ).toEqual({ outcome: "unknown_message" });
    }
    expect(await statusCount()).toBe(count);

    // Por su propia línea, el de ORG_2 sí se registra en ORG_2.
    expect(
      await ingestDeliveryStatus(
        status(foreign.externalId, "read", { lineId: LINE_2 }),
      ),
    ).toEqual({
      outcome: "recorded",
      organizationId: ORG_2,
      messageId: foreign.messageId,
    });
  });

  it("una línea desconocida o inactiva es unknown_line y no escribe nada", async () => {
    const message = await sent(await conversationOn(LINE_1));
    const count = await statusCount();
    for (const lineId of [LINE_OFF, "499999999999999"]) {
      expect(
        await ingestDeliveryStatus(
          status(message.externalId, "delivered", { lineId }),
        ),
      ).toEqual({ outcome: "unknown_line" });
    }
    expect(await statusCount()).toBe(count);
  });

  it("la función exige todos los argumentos (22004) y solo los estados del contrato (23514)", async () => {
    const message = await sent(await conversationOn(LINE_1));
    await expect(
      withIngestion((tx) =>
        tx.execute(
          sql`SELECT * FROM private.ingest_whatsapp_status(${LINE_1}, ${message.externalId}, NULL, now())`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "22004" } });
    await expect(
      withIngestion((tx) =>
        tx.execute(
          sql`SELECT * FROM private.ingest_whatsapp_status(${LINE_1}, ${message.externalId}, 'deleted', now())`,
        ),
      ),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint_name: "message_statuses_status_check",
      },
    });
    expect(await statusRows(message.messageId)).toEqual([]);
  });
});

describe("identidades (DEC-039 §4, DEC-044 §3.3)", () => {
  it("la identidad de la ingesta (sin claims) no ve ni escribe message_statuses por sí misma: solo por la función", async () => {
    const message = await sent(await conversationOn(LINE_1));
    await ingestDeliveryStatus(status(message.externalId, "sent"));

    const visible = await withIngestion((tx) =>
      tx.select().from(messageStatuses),
    );
    expect(visible).toEqual([]);
    await expect(
      withIngestion((tx) =>
        tx.insert(messageStatuses).values({
          organizationId: ORG_1,
          messageId: message.messageId,
          status: "read",
          occurredAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(
      (await statusRows(message.messageId)).map((row) => row.status),
    ).toEqual(["sent"]);
  });

  it("un miembro no puede registrar estados: la función rechaza las llamadas con claims (42501) y RLS no le deja escribir la tabla", async () => {
    const message = await sent(await conversationOn(LINE_1));
    const ctx = tenantContext(USER_C, ORG_1);

    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`SELECT * FROM private.ingest_whatsapp_status(${LINE_1}, ${message.externalId}, 'read', now())`,
        ),
      ),
    ).rejects.toMatchObject({
      cause: {
        code: "42501",
        message: expect.stringMatching(/ingestion_without_user/),
      },
    });
    await expect(
      withTenant(ctx, (tx) =>
        tx.insert(messageStatuses).values({
          organizationId: ORG_1,
          messageId: message.messageId,
          status: "read",
          occurredAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await statusRows(message.messageId)).toEqual([]);
  });

  it("app_runtime sin asumir authenticated no puede ejecutarla (42501)", async () => {
    await expect(
      runtimePool()`SELECT * FROM private.ingest_whatsapp_status(${LINE_1}, 'wamid.RUNTIME', 'read', now())`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cada miembro lee solo los estados de su organización (RLS), también sin el filtro explícito", async () => {
    const own = await sent(await conversationOn(LINE_1));
    const foreign = await sent(
      await conversationOn(LINE_2),
      tenantContext(USER_B, ORG_2),
    );
    await ingestDeliveryStatus(status(own.externalId, "delivered"));
    await ingestDeliveryStatus(
      status(foreign.externalId, "delivered", { lineId: LINE_2 }),
    );

    const seenByOrg1 = await withTenant(tenantContext(USER_C, ORG_1), (tx) =>
      tx.select({ messageId: messageStatuses.messageId }).from(messageStatuses),
    );
    expect(seenByOrg1.map((row) => row.messageId)).toContain(own.messageId);
    expect(seenByOrg1.map((row) => row.messageId)).not.toContain(
      foreign.messageId,
    );

    // C tiene una membership inactiva en ORG_2: no ve sus estados ni pidiendo
    // por id.
    const forged = await withTenant(tenantContext(USER_C, ORG_2), (tx) =>
      tx
        .select()
        .from(messageStatuses)
        .where(
          and(
            eq(messageStatuses.organizationId, ORG_2),
            eq(messageStatuses.messageId, foreign.messageId),
          ),
        ),
    );
    expect(forged).toEqual([]);
  });

  it("append-only: un miembro no edita ni borra estados, y service_role tampoco (C-11)", async () => {
    const message = await sent(await conversationOn(LINE_1));
    await ingestDeliveryStatus(status(message.externalId, "failed"));
    const ctx = tenantContext(USER_C, ORG_1);

    await expect(
      withTenant(ctx, (tx) =>
        tx
          .update(messageStatuses)
          .set({ status: "read" })
          .where(eq(messageStatuses.messageId, message.messageId)),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withTenant(ctx, (tx) =>
        tx
          .delete(messageStatuses)
          .where(eq(messageStatuses.messageId, message.messageId)),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });

    await inRolledBackTransaction(db.admin, async (tx) => {
      for (const statement of [
        `UPDATE public.message_statuses SET status = 'read' WHERE message_id = '${message.messageId}'`,
        `DELETE FROM public.message_statuses WHERE message_id = '${message.messageId}'`,
        "TRUNCATE public.message_statuses",
      ]) {
        await expect(
          asRole(tx, "authenticated", (sp) => sp.unsafe(statement)),
          statement,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          tx.savepoint(async (sp) => {
            await sp.unsafe("SET LOCAL ROLE service_role");
            await sp.unsafe(statement);
          }),
          statement,
        ).rejects.toMatchObject({ code: "42501" });
      }
    });
    expect(
      (await statusRows(message.messageId)).map((row) => row.status),
    ).toEqual(["failed"]);
  });
});

type FoundThread = Extract<InboxThread, { kind: "found" }>;

async function threadOf(conversationId: string): Promise<FoundThread> {
  const inbox = await getInbox(conversationId);
  if (inbox.thread.kind !== "found") throw new Error("thread not found");
  return inbox.thread;
}

function deliveries(thread: FoundThread): Record<string, string | null> {
  return Object.fromEntries(
    thread.sections
      .flatMap((section) => section.bubbles)
      .map((bubble) => [bubble.id, bubble.delivery]),
  );
}

describe("bandeja: el estado real de cada saliente (DEC-044 §3.2)", () => {
  it("muestra el vigente: el de mayor precedencia, y un No entregado tardío no pisa Entregado ni Leído", async () => {
    const conversation = await conversationOn(LINE_1);
    const read = await sent(conversation);
    const failed = await sent(conversation);
    const lateFailure = await sent(conversation);
    const pending = await sent(conversation);

    // Llegan sueltos y fuera de orden, como los envía el proveedor.
    for (const [message, value] of [
      [read, "read"],
      [lateFailure, "delivered"],
      [read, "sent"],
      [failed, "sent"],
      [failed, "failed"],
      [read, "delivered"],
      [lateFailure, "failed"],
      [read, "failed"],
    ] as const) {
      await ingestDeliveryStatus(status(message.externalId, value));
    }

    const thread = await threadOf(conversation.conversationId);
    const inbound = thread.sections
      .flatMap((section) => section.bubbles)
      .find((bubble) => bubble.direction === "inbound");
    expect(deliveries(thread)).toEqual({
      [inbound!.id]: null,
      [read.messageId]: "read",
      [failed.messageId]: "failed",
      [lateFailure.messageId]: "delivered",
      // Sin estados todavía: Meta lo aceptó, así que está enviado.
      [pending.messageId]: "sent",
    });
  });

  it("leer la bandeja no escribe nada", async () => {
    const conversation = await conversationOn(LINE_1);
    const message = await sent(conversation);
    await ingestDeliveryStatus(status(message.externalId, "delivered"));
    const count = await statusCount();
    await threadOf(conversation.conversationId);
    expect(await statusCount()).toBe(count);
  });
});

describe("webhook firmado de punta a punta (Hito 12C)", () => {
  it("registra los estados por la línea, ignora lo que no es del contrato y la bandeja muestra el vigente", async () => {
    const conversation = await conversationOn(LINE_1);
    const message = await sent(conversation);

    const payload = statusWebhook(
      [
        { id: message.externalId, status: "sent", timestamp: 1_793_000_000 },
        { id: message.externalId, status: "read", timestamp: 1_793_000_060 },
        {
          id: message.externalId,
          status: "delivered",
          timestamp: 1_793_000_030,
        },
        // Tardío: no pisa el leído.
        { id: message.externalId, status: "failed", timestamp: 1_793_000_090 },
        { id: "wamid.UNKNOWN12C", status: "read", timestamp: 1_793_000_000 },
        { id: message.externalId, status: "deleted", timestamp: 1_793_000_000 },
      ],
      { lineId: LINE_1 },
    );
    const response = await handleWhatsAppWebhook(signedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ignored: 1,
      statuses: {
        received: 5,
        recorded: 4,
        duplicate: 0,
        unknown_line: 0,
        unknown_message: 1,
        invalid: 0,
      },
    });
    expect(
      (await statusRows(message.messageId)).map((row) => [
        row.status,
        (row.occurred_at as Date).toISOString(),
      ]),
    ).toEqual([
      ["delivered", new Date(1_793_000_030 * 1000).toISOString()],
      ["failed", new Date(1_793_000_090 * 1000).toISOString()],
      ["read", new Date(1_793_000_060 * 1000).toISOString()],
      ["sent", new Date(1_793_000_000 * 1000).toISOString()],
    ]);
    expect(
      deliveries(await threadOf(conversation.conversationId))[
        message.messageId
      ],
    ).toBe("read");

    // El reintento del proveedor (el mismo lote) no escribe nada nuevo.
    const retry = await handleWhatsAppWebhook(signedRequest(payload));
    expect(await retry.json()).toMatchObject({
      statuses: { received: 5, recorded: 0, duplicate: 4, unknown_message: 1 },
    });
    expect(await statusRows(message.messageId)).toHaveLength(4);
  });

  it("la firma de otro secreto es 401 y no escribe nada", async () => {
    const message = await sent(await conversationOn(LINE_1));
    const count = await statusCount();
    const response = await handleWhatsAppWebhook(
      signedRequest(
        statusWebhook([
          { id: message.externalId, status: "read", timestamp: 1_793_000_000 },
        ]),
        { secret: "another-secret-another-secret-xx" },
      ),
    );
    expect(response.status).toBe(401);
    expect(await statusCount()).toBe(count);
  });
});
