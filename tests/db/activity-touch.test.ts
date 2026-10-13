import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { messages, opportunityNotes } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";

import { closureColumns } from "./support/closures";
import {
  asRole,
  inRolledBackTransaction,
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
  USER_C,
} from "./support/tenants";

/*
 * Toque de actividad (Hito 4, DEC-036 §1 a §3) contra PostgreSQL 17 con las
 * migraciones aplicadas: una nota o un mensaje nuevos mueven el
 * `last_activity_at` de su oportunidad, desde la base.
 *
 *   INSERT (withTenant(), RLS) → trigger AFTER INSERT →
 *   private.touch_opportunity_activity() (SECURITY DEFINER) → UPDATE de la
 *   oportunidad → trigger de transiciones (toque válido) → COMMIT
 *
 * Las altas pasan por el boundary real, conectado como app_runtime. Los
 * UPDATE directos se prueban como el rol dueño (postgres) y el superusuario.
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

const DAY = 86_400_000;
let sequence = 0;

/**
 * Una oportunidad propia del caso, en `stage`, con su última actividad (y
 * su última edición) hace un día, salvo que se pida otra. Cerrada, trae
 * metadatos de cierre válidos, y `won`, su unidad (DEC-034).
 */
async function opportunity(
  organizationId: string,
  options: { stage?: Stage; lastActivityAt?: Date } = {},
): Promise<{ id: string; contactId: string }> {
  const stage = options.stage ?? "negotiating";
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  let vehicleId: string | null = null;
  if (stage === "won") {
    vehicleId = randomUUID();
    await db.admin`
      INSERT INTO public.vehicles (id, organization_id, brand, model, year,
        status)
      VALUES (${vehicleId}, ${organizationId}, 'Toyota', 'Hilux', 2025,
        'available')
    `;
  }
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Prueba actividad ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      vehicle_id: vehicleId,
      source: "whatsapp",
      ...closureColumns(stage),
      last_activity_at: options.lastActivityAt ?? new Date(Date.now() - DAY),
      created_at: new Date(Date.now() - 2 * DAY),
      updated_at: new Date(Date.now() - DAY),
    })}
  `;
  return { id, contactId };
}

/** La oportunidad tal como está en la base (sin RLS), sin `id`. */
async function row(id: string) {
  const [found] = await db.admin<
    {
      stage: string;
      vehicleId: string | null;
      lossReason: string | null;
      salePrice: string | null;
      lastActivityAt: Date;
      updatedAt: Date;
    }[]
  >`
    SELECT stage, vehicle_id AS "vehicleId", loss_reason AS "lossReason",
      sale_price AS "salePrice", last_activity_at AS "lastActivityAt",
      updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found!;
}

function note(ctx: TenantContext, opportunityId: string) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(opportunityNotes)
      .values({
        organizationId: ctx.organizationId,
        opportunityId,
        body: "Llamé al cliente.",
        recordedBy: ctx.userId,
      })
      .returning({ at: opportunityNotes.recordedAt }),
  );
}

function message(
  ctx: TenantContext,
  contactId: string,
  opportunityId: string | null,
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(messages)
      .values({
        organizationId: ctx.organizationId,
        contactId,
        opportunityId,
        channel: "whatsapp",
        direction: "inbound",
        content: "¿Sigue disponible?",
        recordedBy: ctx.userId,
      })
      .returning({ at: messages.createdAt }),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("una nota o un mensaje nuevos mueven la recencia de su oportunidad", () => {
  it("una nota la mueve al reloj de su alta; updated_at, etapa y unidad no cambian", async () => {
    const { id } = await opportunity(ORG_1);
    const before = await row(id);

    const [inserted] = await note(ctxA(), id);

    const after = await row(id);
    expect(after).toEqual({ ...before, lastActivityAt: inserted!.at });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(
      before.lastActivityAt.getTime(),
    );
  });

  it("un mensaje asociado la mueve al created_at del mensaje, también registrado por un seller", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    const before = await row(id);

    const [inserted] = await message(
      tenantContext(USER_C, ORG_1),
      contactId,
      id,
    );

    expect(await row(id)).toEqual({ ...before, lastActivityAt: inserted!.at });
  });

  it("solo toca la oportunidad del registro: ni otra del mismo contacto, ni de la organización, ni de otra organización", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    // Otra oportunidad del mismo contacto.
    const sibling = randomUUID();
    await db.admin`
      INSERT INTO public.opportunities (id, organization_id, contact_id, stage,
        source, last_activity_at)
      VALUES (${sibling}, ${ORG_1}, ${contactId}, 'new', 'web',
        now() - interval '1 day')
    `;
    const other = await opportunity(ORG_1);
    const foreign = await opportunity(ORG_2);
    const untouched = await Promise.all(
      [sibling, other.id, foreign.id].map(row),
    );

    await note(ctxA(), id);
    await message(ctxA(), contactId, id);

    expect(await Promise.all([sibling, other.id, foreign.id].map(row))).toEqual(
      untouched,
    );
  });

  it("un mensaje sin oportunidad no toca ninguna, tampoco las del contacto", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    const before = await row(id);

    await message(ctxA(), contactId, null);

    expect(await row(id)).toEqual(before);
  });

  it.each(OPPORTUNITY_STAGES)(
    "toca en %s, también cerrada, sin tocar el cierre",
    async (stage) => {
      const { id, contactId } = await opportunity(ORG_1, { stage });
      const before = await row(id);

      const [inserted] = await message(ctxA(), contactId, id);

      expect(await row(id)).toEqual({
        ...before,
        lastActivityAt: inserted!.at,
      });
    },
  );

  it("una nota y un mensaje en la misma transacción tocan una vez, con el mismo reloj", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    const before = await row(id);

    const at = await withTenant(ctxA(), async (tx) => {
      const [first] = await tx
        .insert(opportunityNotes)
        .values({
          organizationId: ORG_1,
          opportunityId: id,
          body: "Primera",
          recordedBy: USER_A,
        })
        .returning({ at: opportunityNotes.recordedAt });
      await tx.insert(messages).values({
        organizationId: ORG_1,
        contactId,
        opportunityId: id,
        channel: "manual",
        direction: "outbound",
        content: "Segunda",
        recordedBy: USER_A,
      });
      return first!.at;
    });

    expect(await row(id)).toEqual({ ...before, lastActivityAt: at });
  });

  it("solo avanza: una recencia en el futuro (reloj desfasado) no retrocede", async () => {
    const future = new Date(Date.now() + DAY);
    const { id, contactId } = await opportunity(ORG_1, {
      lastActivityAt: future,
    });

    await note(ctxA(), id);
    await message(ctxA(), contactId, id);

    expect((await row(id)).lastActivityAt).toEqual(future);
  });

  it("una transacción más vieja que confirma después no la hace retroceder", async () => {
    const { id } = await opportunity(ORG_1);
    let older: Date | undefined;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const olderStarted = new Promise<void>((resolve) => (started = resolve));

    // La transacción vieja empieza primero (fija su now()) y anota al final.
    const olderTx = withTenant(ctxA(), async (tx) => {
      await tx.select({ id: opportunityNotes.id }).from(opportunityNotes);
      started();
      await released;
      const [inserted] = await tx
        .insert(opportunityNotes)
        .values({
          organizationId: ORG_1,
          opportunityId: id,
          body: "Vieja",
          recordedBy: USER_A,
        })
        .returning({ at: opportunityNotes.recordedAt });
      older = inserted!.at;
    });
    try {
      await olderStarted;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const [newer] = await note(ctxA(), id);
      release();
      await olderTx;

      expect(older!.getTime()).toBeLessThan(newer!.at.getTime());
      expect((await row(id)).lastActivityAt).toEqual(newer!.at);
    } finally {
      release();
      await olderTx.catch(() => {});
    }
  });
});

describe("nadie más mueve last_activity_at (opportunities_activity_touch)", () => {
  it("un UPDATE directo se rechaza, también para el rol dueño y el superusuario (23514)", async () => {
    const { id } = await opportunity(ORG_1);
    const before = await row(id);
    const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      for (const run of [
        () =>
          owner`UPDATE public.opportunities SET last_activity_at = now() WHERE id = ${id}`,
        () =>
          db.admin`UPDATE public.opportunities SET last_activity_at = now() WHERE id = ${id}`,
        () =>
          owner`UPDATE public.opportunities SET last_activity_at = now() - interval '1 hour' WHERE id = ${id}`,
      ]) {
        await expect(run()).rejects.toMatchObject({
          code: "23514",
          constraint_name: "opportunities_activity_touch",
        });
      }
    } finally {
      await owner.end();
    }
    expect(await row(id)).toEqual(before);
  });

  it("un pase de etapa o un cambio de unidad que la toquen se rechazan (23514)", async () => {
    const { id } = await opportunity(ORG_1, { stage: "new" });
    const negotiating = await opportunity(ORG_1, { stage: "negotiating" });
    const vehicle = randomUUID();
    await db.admin`
      INSERT INTO public.vehicles (id, organization_id, brand, model, year,
        status)
      VALUES (${vehicle}, ${ORG_1}, 'Toyota', 'Corolla', 2024, 'available')
    `;
    const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      await expect(
        owner`UPDATE public.opportunities SET stage = 'qualifying', last_activity_at = now() WHERE id = ${id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "opportunities_activity_touch",
      });
      await expect(
        owner`UPDATE public.opportunities SET vehicle_id = ${vehicle}, last_activity_at = now() WHERE id = ${negotiating.id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "opportunities_activity_touch",
      });
    } finally {
      await owner.end();
    }
    expect((await row(id)).stage).toBe("new");
    expect((await row(negotiating.id)).vehicleId).toBeNull();
  });

  it("un pase de etapa por el boundary sigue sin moverla (DEC-032 §7)", async () => {
    const { id } = await opportunity(ORG_1, { stage: "new" });
    const before = await row(id);
    await withTenant(ctxA(), (tx) =>
      tx.execute(
        sql`UPDATE public.opportunities SET stage = 'qualifying' WHERE id = ${id}`,
      ),
    );
    const after = await row(id);
    expect(after.stage).toBe("qualifying");
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
  });

  it("authenticated no ejecuta la función del toque (42501) ni puede crear triggers", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await expect(
        tx.savepoint((sp) =>
          asRole(
            sp,
            "authenticated",
            (as) => as`SELECT private.touch_opportunity_activity()`,
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        tx.savepoint((sp) =>
          asRole(
            sp,
            "authenticated",
            (as) =>
              as`CREATE TRIGGER probe AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_activity()`,
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
