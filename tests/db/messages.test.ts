import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { messages } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { MESSAGE_MAX_LENGTH } from "@/domains/conversations/messages";

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
  USER_C,
  USER_D,
} from "./support/tenants";

/*
 * Mensajes (Hito 4, DEC-036 §4 y §5) contra PostgreSQL 17 con las
 * migraciones aplicadas, por el boundary real (withTenant(), conectado como
 * app_runtime): aislamiento por organización (RLS de lectura y alta), autor
 * y reloj de la base, FKs compuestas al contacto y a la oportunidad de ese
 * contacto, CHECKs de canal, dirección y texto, y append-only para todos los
 * roles de la app. La recencia que mueve un mensaje se prueba en
 * activity-touch.test.ts y la Server Action addMessage(), en
 * add-message.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 */

vi.mock("server-only", () => ({}));

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

let sequence = 0;

/** Un contacto propio del caso. */
async function contact(organizationId: string): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${id}, ${organizationId}, ${`Prueba mensajes ${sequence}`})
  `;
  return id;
}

/** Una oportunidad abierta propia del caso, con su contacto. */
async function opportunity(
  organizationId: string,
): Promise<{ id: string; contactId: string }> {
  const contactId = await contact(organizationId);
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.opportunities (id, organization_id, contact_id, stage,
      source)
    VALUES (${id}, ${organizationId}, ${contactId}, 'new', 'whatsapp')
  `;
  return { id, contactId };
}

type MessageRecord = {
  id: string;
  organizationId: string;
  contactId: string;
  opportunityId: string | null;
  channel: string;
  direction: string;
  content: string;
  recordedBy: string;
  createdAt: Date;
};

/** Los mensajes de un contacto tal como están en la base (sin RLS). */
async function messagesOf(contactId: string): Promise<MessageRecord[]> {
  return db.admin<MessageRecord[]>`
    SELECT id, organization_id AS "organizationId", contact_id AS "contactId",
      opportunity_id AS "opportunityId", channel, direction, content,
      recorded_by AS "recordedBy", created_at AS "createdAt"
    FROM public.messages WHERE contact_id = ${contactId}
    ORDER BY created_at, id
  `;
}

/** Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`. */
async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    cause: {
      code,
      ...(constraint ? { constraint_name: constraint } : {}),
    },
  });
}

/** INSERT directo por el boundary, sin pasar por la Server Action. */
function directInsert(
  ctx: TenantContext,
  values: Partial<typeof messages.$inferInsert> &
    Pick<typeof messages.$inferInsert, "contactId">,
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(messages)
      .values({
        organizationId: ctx.organizationId,
        channel: "whatsapp",
        direction: "inbound",
        content: "Mensaje directo",
        recordedBy: ctx.userId,
        ...values,
      })
      .returning({ id: messages.id }),
  );
}

function readAs(ctx: TenantContext, contactId: string) {
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.contactId, contactId)),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("alta por el boundary: miembro activo, autor de la request y reloj de la base", () => {
  it("admin (A) registra un mensaje de su organización asociado a una oportunidad", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    expect(
      await directInsert(ctxA(), {
        contactId,
        opportunityId: id,
        channel: "email",
        direction: "outbound",
        content: "Te paso la cotización.",
      }),
    ).toHaveLength(1);
    const [message, ...rest] = await messagesOf(contactId);
    expect(rest).toEqual([]);
    expect(message).toMatchObject({
      organizationId: ORG_1,
      contactId,
      opportunityId: id,
      channel: "email",
      direction: "outbound",
      content: "Te paso la cotización.",
      recordedBy: USER_A,
    });
    const [delta] = await db.admin<{ seconds: number }[]>`
      SELECT extract(epoch FROM (now() - created_at))::float AS seconds
      FROM public.messages WHERE id = ${message!.id}
    `;
    expect(delta!.seconds).toBeLessThan(60);
  });

  it("seller (C con ORG_1 activa) también registra; sin oportunidad, alcanza el contacto de la organización", async () => {
    const contactId = await contact(ORG_1);
    expect(
      await directInsert(tenantContext(USER_C, ORG_1), { contactId }),
    ).toHaveLength(1);
    expect(await messagesOf(contactId)).toMatchObject([
      { opportunityId: null, recordedBy: USER_C },
    ]);
  });

  it("el autor tiene que ser el usuario de la request (42501)", async () => {
    const contactId = await contact(ORG_1);
    await expectSqlError(
      directInsert(ctxA(), { contactId, recordedBy: USER_C }),
      "42501",
    );
    expect(await messagesOf(contactId)).toEqual([]);
  });

  it("la fecha la pone la base: una fecha del pedido falla (42501)", async () => {
    const contactId = await contact(ORG_1);
    await expectSqlError(
      directInsert(ctxA(), {
        contactId,
        createdAt: new Date("2000-01-01T00:00:00Z"),
      }),
      "42501",
    );
    expect(await messagesOf(contactId)).toEqual([]);
  });

  it("no se registra en una organización sin membership activa (42501)", async () => {
    const foreign = await contact(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), { organizationId: ORG_2, contactId: foreign }),
      "42501",
    );
    // D: membership inactiva en ORG_1.
    const mine = await contact(ORG_1);
    await expectSqlError(
      directInsert(tenantContext(USER_D, ORG_1), { contactId: mine }),
      "42501",
    );
    // Contexto falsificado: B (solo ORG_2) con ORG_1 como organización.
    await expectSqlError(
      directInsert(tenantContext(USER_B, ORG_1), { contactId: mine }),
      "42501",
    );
    expect(await messagesOf(foreign)).toEqual([]);
    expect(await messagesOf(mine)).toEqual([]);
  });
});

describe("FKs compuestas: el contacto y la oportunidad son de la misma organización, y la oportunidad es de ese contacto", () => {
  it("un contacto de otra organización con la organización propia falla (23503)", async () => {
    const foreign = await contact(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), { contactId: foreign }),
      "23503",
      "messages_contact_fk",
    );
    expect(await messagesOf(foreign)).toEqual([]);
  });

  it("una oportunidad de otra organización falla, aun con el contacto propio (23503)", async () => {
    const mine = await contact(ORG_1);
    const foreign = await opportunity(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), { contactId: mine, opportunityId: foreign.id }),
      "23503",
      "messages_opportunity_fk",
    );
    expect(await messagesOf(mine)).toEqual([]);
  });

  it("una oportunidad de la organización con otro contacto falla (23503)", async () => {
    const { id } = await opportunity(ORG_1);
    const other = await contact(ORG_1);
    await expectSqlError(
      directInsert(ctxA(), { contactId: other, opportunityId: id }),
      "23503",
      "messages_opportunity_fk",
    );
    expect(await messagesOf(other)).toEqual([]);
  });

  it("un contacto o una oportunidad con mensajes no se borran, ni con el rol dueño (RESTRICT)", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    await directInsert(ctxA(), { contactId, opportunityId: id });
    await expect(
      db.admin`DELETE FROM public.opportunities WHERE id = ${id}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "messages_opportunity_fk",
    });
    const loose = await contact(ORG_1);
    await directInsert(ctxA(), { contactId: loose });
    await expect(
      db.admin`DELETE FROM public.contacts WHERE id = ${loose}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "messages_contact_fk",
    });
  });
});

describe("lectura aislada por organización (RLS)", () => {
  it("A y B leen solo los mensajes de su organización", async () => {
    const mine = await contact(ORG_1);
    const theirs = await contact(ORG_2);
    await directInsert(ctxA(), { contactId: mine });
    await directInsert(tenantContext(USER_B, ORG_2), { contactId: theirs });

    expect(await readAs(ctxA(), mine)).toHaveLength(1);
    expect(await readAs(ctxA(), theirs)).toEqual([]);
    expect(await readAs(tenantContext(USER_B, ORG_2), theirs)).toHaveLength(1);
    expect(await readAs(tenantContext(USER_B, ORG_2), mine)).toEqual([]);
  });

  it("una membership inactiva (D) y un contexto falsificado (B con ORG_1) no leen", async () => {
    const mine = await contact(ORG_1);
    await directInsert(ctxA(), { contactId: mine });
    for (const ctx of [
      tenantContext(USER_D, ORG_1),
      tenantContext(USER_B, ORG_1),
    ]) {
      expect(await readAs(ctx, mine)).toEqual([]);
    }
  });
});

describe("CHECKs de canal, dirección y texto", () => {
  it.each([
    [
      "un canal fuera de la lista",
      { channel: "sms" },
      "messages_channel_check",
    ],
    [
      "una dirección fuera de la lista",
      { direction: "incoming" },
      "messages_direction_check",
    ],
    ["un texto vacío", { content: "" }, "messages_content_check"],
    [
      "un texto con espacios en los bordes",
      { content: " Hola " },
      "messages_content_check",
    ],
    [
      "un texto con un salto de línea en el borde",
      { content: "Hola\n" },
      "messages_content_check",
    ],
    ["un texto con un tab", { content: "Uno\tdos" }, "messages_content_check"],
    [
      "un texto con un retorno de carro",
      { content: "Uno\r\ndos" },
      "messages_content_check",
    ],
    [
      "un texto demasiado largo",
      { content: "a".repeat(MESSAGE_MAX_LENGTH + 1) },
      "messages_content_check",
    ],
  ] as const)(
    "rechaza %s aunque no pase por el dominio (23514)",
    async (_, values, constraint) => {
      const contactId = await contact(ORG_1);
      await expectSqlError(
        directInsert(ctxA(), {
          contactId,
          ...(values as Partial<typeof messages.$inferInsert>),
        }),
        "23514",
        constraint,
      );
      expect(await messagesOf(contactId)).toEqual([]);
    },
  );

  it("admite el largo máximo exacto, contado en caracteres, y saltos de línea internos", async () => {
    const contactId = await contact(ORG_1);
    const longest = "🚗".repeat(MESSAGE_MAX_LENGTH);
    await directInsert(ctxA(), { contactId, content: longest });
    await directInsert(ctxA(), { contactId, content: "Uno\n\nDos" });
    expect((await messagesOf(contactId)).map((m) => m.content).sort()).toEqual(
      [longest, "Uno\n\nDos"].sort(),
    );
  });
});

describe("append-only para todos los roles de la app", () => {
  it("authenticated no actualiza ni borra mensajes, ni los propios (42501)", async () => {
    const contactId = await contact(ORG_1);
    await directInsert(ctxA(), { contactId, content: "Original" });
    const [message] = await messagesOf(contactId);
    for (const statement of [
      sql`UPDATE public.messages SET content = 'Editado' WHERE id = ${message!.id}`,
      sql`UPDATE public.messages SET channel = 'email' WHERE id = ${message!.id}`,
      sql`UPDATE public.messages SET created_at = now() WHERE id = ${message!.id}`,
      sql`DELETE FROM public.messages WHERE id = ${message!.id}`,
      sql`TRUNCATE public.messages`,
    ]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) => tx.execute(statement)),
        "42501",
      );
    }
    expect((await messagesOf(contactId))[0]!.content).toBe("Original");
  });

  it("app_runtime fuera del boundary, anon y service_role no escriben ni editan mensajes (42501)", async () => {
    const contactId = await contact(ORG_1);
    await directInsert(ctxA(), { contactId, content: "Original" });
    const [message] = await messagesOf(contactId);
    await expect(
      runtimePool()`INSERT INTO public.messages (organization_id, contact_id, channel, direction, content, recorded_by) VALUES (${ORG_1}, ${contactId}, 'whatsapp', 'inbound', 'x', ${USER_A})`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimePool()`SELECT id FROM public.messages`,
    ).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "service_role"]) {
      for (const statement of [
        `UPDATE public.messages SET content = 'x' WHERE id = '${message!.id}'`,
        `DELETE FROM public.messages WHERE id = '${message!.id}'`,
        "TRUNCATE public.messages",
      ]) {
        await expect(
          db.admin.begin(async (tx: TransactionSql) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx.unsafe(statement);
          }),
          `${role}: ${statement}`,
        ).rejects.toMatchObject({ code: "42501" });
      }
    }
    expect((await messagesOf(contactId))[0]!.content).toBe("Original");
  });
});
