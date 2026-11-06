import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { quotes } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { quoteTotal, type Discount } from "@/domains/quotes/pricing";
import { addDays } from "@/domains/quotes/request";
import {
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  type QuoteStatus,
} from "@/domains/quotes/statuses";

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
  USER_C,
} from "./support/tenants";

/*
 * Cotizaciones (Hito 10, DEC-042) contra PostgreSQL 17 con las migraciones
 * aplicadas: RLS de lectura y alta, número correlativo por organización,
 * CHECKs de precio, descuento, validez y sellos, y el trigger de estados
 * (matriz, validez, oportunidad abierta, unidad en stock, aprobación de
 * admin e inmutabilidad), por el boundary real (withTenant() como
 * app_runtime → authenticated) y con el superusuario.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1.
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

const ctxA = (): TenantContext => tenantContext(USER_A, ORG_1);
const ctxB = (): TenantContext => tenantContext(USER_B, ORG_2);
const ctxC = (): TenantContext => tenantContext(USER_C, ORG_1);

type StageName = "new" | "qualifying" | "negotiating" | "won" | "lost";
type VehicleStatus = "in_preparation" | "available" | "reserved" | "sold";

let sequence = 0;

/** Una unidad propia del caso, con precio publicado. */
async function vehicle(
  organizationId: string,
  status: VehicleStatus = "available",
  price = "50000.00",
  currency: "USD" | "PYG" = "USD",
): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, year, status, price, currency)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux', 2024, ${status}, ${price}, ${currency})
  `;
  return id;
}

/** Una oportunidad propia del caso, en `stage`, con su contacto. */
async function opportunity(
  organizationId: string,
  stage: StageName = "negotiating",
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  const vehicleId =
    stage === "won" ? await vehicle(organizationId, "sold") : null;
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Cliente cotización ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      vehicle_id: vehicleId,
      source: "web",
      ...closureColumns(stage),
    })}
  `;
  return id;
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

const today = () => todayInAsuncion(new Date());

type Terms = {
  listPrice?: string;
  currency?: "USD" | "PYG";
  discount?: Discount;
  totalPrice?: string;
  validUntil?: string;
};

/** Alta por el boundary, como la hará la capa de escritura. */
function insertQuote(
  ctx: TenantContext,
  opportunityId: string,
  vehicleId: string,
  terms: Terms = {},
) {
  const listPrice = terms.listPrice ?? "50000.00";
  const currency = terms.currency ?? "USD";
  const discount = terms.discount ?? { kind: "none" };
  const total =
    terms.totalPrice ??
    quoteTotal({ amount: listPrice, currency }, discount).amount;
  return withTenant(ctx, (tx) =>
    tx
      .insert(quotes)
      .values({
        organizationId: ctx.organizationId,
        opportunityId,
        vehicleId,
        currency,
        listPrice,
        discountKind: discount.kind,
        discountValue: discount.kind === "none" ? null : discount.value,
        totalPrice: total,
        validUntil: terms.validUntil ?? addDays(today(), 7),
        createdBy: ctx.userId,
      })
      .returning({ id: quotes.id, number: quotes.number }),
  ).then((rows) => rows[0]!);
}

/** Una cotización nueva en ORG_1 (oportunidad y unidad propias). */
async function freshQuote(
  ctx: TenantContext = ctxA(),
  terms: Terms = {},
): Promise<{ id: string; opportunityId: string; vehicleId: string }> {
  const opportunityId = await opportunity(ctx.organizationId);
  const vehicleId = await vehicle(
    ctx.organizationId,
    "available",
    terms.listPrice,
    terms.currency,
  );
  const { id } = await insertQuote(ctx, opportunityId, vehicleId, terms);
  return { id, opportunityId, vehicleId };
}

function setStatus(ctx: TenantContext, id: string, status: QuoteStatus) {
  return withTenant(ctx, (tx) =>
    tx.update(quotes).set({ status }).where(eq(quotes.id, id)).returning(),
  );
}

async function rowOf(id: string) {
  const [row] = await db.admin`
    SELECT status, number, approved_by, approved_at, sent_at, decided_at
    FROM public.quotes WHERE id = ${id}
  `;
  return row!;
}

describe("alta", () => {
  it("admin y seller crean borradores; el número es correlativo por organización", async () => {
    const first = await freshQuote(ctxA());
    const second = await freshQuote(ctxC());
    const foreign = await freshQuote(ctxB());

    const [a, c, b] = await Promise.all([
      rowOf(first.id),
      rowOf(second.id),
      rowOf(foreign.id),
    ]);
    expect(a.status).toBe("draft");
    expect(c.number).toBe(a.number + 1);
    expect(b.number).toBe(1);
  });

  it("el número lo asigna la base aunque el cliente mande otro", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    const [row] = await withTenant(ctxA(), (tx) =>
      tx
        .insert(quotes)
        .values({
          organizationId: ORG_1,
          opportunityId,
          vehicleId,
          number: 9999,
          currency: "USD",
          listPrice: "50000.00",
          totalPrice: "50000.00",
          validUntil: addDays(today(), 7),
          createdBy: USER_A,
        })
        .returning({ number: quotes.number }),
    );
    expect(row!.number).not.toBe(9999);
  });

  it("altas simultáneas de la misma organización no repiten número", async () => {
    const pairs = await Promise.all(
      Array.from({ length: 6 }, async () => ({
        opportunityId: await opportunity(ORG_1),
        vehicleId: await vehicle(ORG_1),
      })),
    );
    const created = await Promise.all(
      pairs.map(({ opportunityId, vehicleId }) =>
        insertQuote(ctxA(), opportunityId, vehicleId),
      ),
    );
    const numbers = created.map((row) => row.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("la lista es el precio publicado de la unidad (RLS 42501 si no coincide)", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1, "available", "50000.00", "USD");
    await expectSqlError(
      insertQuote(ctxA(), opportunityId, vehicleId, { listPrice: "40000.00" }),
      "42501",
    );
    await expectSqlError(
      insertQuote(ctxA(), opportunityId, vehicleId, {
        listPrice: "50000.00",
        currency: "PYG",
      }),
      "42501",
    );
  });

  it("solo oportunidades calificando o negociando y unidades disponibles o reservadas", async () => {
    for (const stage of ["new", "won", "lost"] as const) {
      const opportunityId = await opportunity(ORG_1, stage);
      await expectSqlError(
        insertQuote(ctxA(), opportunityId, await vehicle(ORG_1)),
        "42501",
      );
    }
    for (const status of ["in_preparation", "sold"] as const) {
      await expectSqlError(
        insertQuote(
          ctxA(),
          await opportunity(ORG_1),
          await vehicle(ORG_1, status),
        ),
        "42501",
      );
    }
    await insertQuote(
      ctxA(),
      await opportunity(ORG_1, "qualifying"),
      await vehicle(ORG_1, "reserved"),
    );
  });

  it("no se crea en otra organización ni con otro autor ni con otro estado", async () => {
    const foreignOpportunity = await opportunity(ORG_2);
    const foreignVehicle = await vehicle(ORG_2);
    // Organización ajena aunque el contexto diga otra cosa.
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.insert(quotes).values({
          organizationId: ORG_2,
          opportunityId: foreignOpportunity,
          vehicleId: foreignVehicle,
          currency: "USD",
          listPrice: "50000.00",
          totalPrice: "50000.00",
          validUntil: addDays(today(), 7),
          createdBy: USER_A,
        }),
      ),
      "42501",
    );
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    for (const values of [
      { createdBy: USER_C },
      { status: "approved" as const },
    ]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.insert(quotes).values({
            organizationId: ORG_1,
            opportunityId,
            vehicleId,
            currency: "USD",
            listPrice: "50000.00",
            totalPrice: "50000.00",
            validUntil: addDays(today(), 7),
            createdBy: USER_A,
            ...values,
          }),
        ),
        "42501",
      );
    }
    // Unidad de otra organización con la oportunidad propia: el EXISTS de
    // la policy no la encuentra en la organización (la FK compuesta es el
    // respaldo).
    await expectSqlError(
      insertQuote(ctxA(), opportunityId, foreignVehicle),
      "42501",
    );
    await expect(
      db.admin`
        INSERT INTO public.quotes (organization_id, opportunity_id, vehicle_id, currency, list_price, total_price, valid_until, created_by)
        VALUES (${ORG_1}, ${opportunityId}, ${foreignVehicle}, 'USD', 50000, 50000, ${addDays(today(), 7)}, ${USER_A})
      `,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "quotes_vehicle_fk",
    });
  });

  it("los CHECKs rechazan un total inconsistente, un descuento fuera de rango y una validez fuera de la ventana", async () => {
    const cases: [Terms, string][] = [
      [{ totalPrice: "49999.00" }, "quotes_total_price_check"],
      [
        {
          discount: { kind: "percent", value: "10.00" },
          totalPrice: "50000.00",
        },
        "quotes_total_price_check",
      ],
      [
        { discount: { kind: "percent", value: "30.01" } },
        "quotes_discount_check",
      ],
      [
        { discount: { kind: "amount", value: "15000.01" } },
        "quotes_discount_check",
      ],
      [{ validUntil: addDays(today(), -1) }, "quotes_valid_until_check"],
      [{ validUntil: addDays(today(), 31) }, "quotes_valid_until_check"],
    ];
    for (const [terms, constraint] of cases) {
      const opportunityId = await opportunity(ORG_1);
      const vehicleId = await vehicle(ORG_1);
      await expectSqlError(
        insertQuote(ctxA(), opportunityId, vehicleId, terms),
        "23514",
        constraint,
      );
    }
    // PYG: el descuento en monto no lleva decimales.
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1, "available", "150000000.00", "PYG");
    await expectSqlError(
      insertQuote(ctxA(), opportunityId, vehicleId, {
        listPrice: "150000000.00",
        currency: "PYG",
        discount: { kind: "amount", value: "1000.50" },
        totalPrice: "149998999.50",
      }),
      "23514",
    );
  });

  it("RLS de lectura: cada organización ve solo sus cotizaciones", async () => {
    const own = await freshQuote(ctxA());
    const foreign = await freshQuote(ctxB());
    const visible = await withTenant(ctxC(), (tx) =>
      tx.select({ id: quotes.id }).from(quotes),
    );
    const ids = visible.map((row) => row.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("app_runtime fuera del boundary y anon no leen ni escriben (42501)", async () => {
    const { id } = await freshQuote();
    await expect(
      runtimePool()`SELECT id FROM public.quotes`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx: TransactionSql) => {
        await tx.unsafe("SET LOCAL ROLE anon");
        await tx`UPDATE public.quotes SET status = 'withdrawn' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await rowOf(id)).status).toBe("draft");
  });
});

describe("estados", () => {
  it("recorre la matriz con sellos: aprobar, enviar, aceptar", async () => {
    const { id } = await freshQuote(ctxA(), {
      discount: { kind: "percent", value: "5.00" },
    });
    await setStatus(ctxC(), id, "approved");
    let row = await rowOf(id);
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(USER_C);
    expect(row.approved_at).toBeInstanceOf(Date);
    expect(row.sent_at).toBeNull();

    await setStatus(ctxC(), id, "sent");
    row = await rowOf(id);
    expect(row.sent_at).toBeInstanceOf(Date);

    await setStatus(ctxA(), id, "accepted");
    row = await rowOf(id);
    expect(row.status).toBe("accepted");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("la matriz del trigger es la del dominio (todos los pares)", async () => {
    for (const from of QUOTE_STATUSES) {
      for (const to of QUOTE_STATUSES) {
        const { id } = await freshQuote();
        // Lleva la cotización hasta `from` por un camino válido.
        const path: Record<QuoteStatus, QuoteStatus[]> = {
          draft: [],
          approved: ["approved"],
          sent: ["approved", "sent"],
          accepted: ["approved", "sent", "accepted"],
          rejected: ["approved", "sent", "rejected"],
          withdrawn: ["withdrawn"],
        };
        for (const step of path[from]) await setStatus(ctxA(), id, step);
        const update = setStatus(ctxA(), id, to);
        if (QUOTE_TRANSITIONS[from].includes(to)) {
          await update;
          expect((await rowOf(id)).status).toBe(to);
        } else {
          await expectSqlError(update, "23514", "quotes_status_transition");
          expect((await rowOf(id)).status).toBe(from);
        }
      }
    }
  });

  it("un descuento mayor al 10 % solo lo aprueba un admin", async () => {
    for (const discount of [
      { kind: "percent", value: "10.01" },
      { kind: "amount", value: "5000.01" },
    ] as const) {
      const { id } = await freshQuote(ctxA(), { discount });
      await expectSqlError(
        setStatus(ctxC(), id, "approved"),
        "23514",
        "quotes_discount_requires_admin",
      );
      await setStatus(ctxA(), id, "approved");
      expect((await rowOf(id)).approved_by).toBe(USER_A);
    }
    // Justo en el límite, el seller aprueba.
    const { id } = await freshQuote(ctxA(), {
      discount: { kind: "amount", value: "5000.00" },
    });
    await setStatus(ctxC(), id, "approved");
  });

  it("vencida: no se aprueba, envía ni acepta; sí se anula", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    const created = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const validUntil = addDays(todayInAsuncion(created), 3);
    const [seeded] = await db.admin`
      INSERT INTO public.quotes ${db.admin({
        organization_id: ORG_1,
        opportunity_id: opportunityId,
        vehicle_id: vehicleId,
        currency: "USD",
        list_price: "50000.00",
        total_price: "50000.00",
        valid_until: validUntil,
        created_by: USER_A,
        created_at: created,
        updated_at: created,
      })}
      RETURNING id
    `;
    const id = seeded!.id as string;
    await expectSqlError(
      setStatus(ctxA(), id, "approved"),
      "23514",
      "quotes_expired",
    );
    await setStatus(ctxA(), id, "withdrawn");
    expect((await rowOf(id)).status).toBe("withdrawn");
  });

  it("con la oportunidad cerrada no se aprueba ni acepta; con la unidad vendida no se acepta", async () => {
    const closed = await freshQuote();
    await db.admin`
      UPDATE public.opportunities
      SET stage = 'lost', loss_reason = 'price'
      WHERE id = ${closed.opportunityId}
    `;
    await expectSqlError(
      setStatus(ctxA(), closed.id, "approved"),
      "23514",
      "quotes_opportunity_closed",
    );
    await setStatus(ctxA(), closed.id, "withdrawn");

    const sold = await freshQuote();
    await setStatus(ctxA(), sold.id, "approved");
    await setStatus(ctxA(), sold.id, "sent");
    // Otra oportunidad se ganó con la unidad cotizada: la venta (propuesta
    // DEC-051) la deja vendida. El superusuario arma el cierre con un INSERT
    // y la unidad pasa a `sold` por el trigger, que exige esa ganada.
    sequence += 1;
    const buyer = randomUUID();
    await db.admin`
      INSERT INTO public.contacts (id, organization_id, name)
      VALUES (${buyer}, ${ORG_1}, ${`Comprador ${sequence}`})
    `;
    await db.admin`
      INSERT INTO public.opportunities ${db.admin({
        id: randomUUID(),
        organization_id: ORG_1,
        contact_id: buyer,
        stage: "won",
        vehicle_id: sold.vehicleId,
        source: "web",
        ...closureColumns("won"),
      })}
    `;
    await db.admin`UPDATE public.vehicles SET status = 'sold' WHERE id = ${sold.vehicleId}`;
    await expectSqlError(
      setStatus(ctxA(), sold.id, "accepted"),
      "23514",
      "quotes_vehicle_unavailable",
    );
    await setStatus(ctxA(), sold.id, "rejected");
  });

  it("a lo sumo una cotización aceptada por oportunidad (23505)", async () => {
    const opportunityId = await opportunity(ORG_1);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { id } = await insertQuote(
        ctxA(),
        opportunityId,
        await vehicle(ORG_1),
      );
      await setStatus(ctxA(), id, "approved");
      await setStatus(ctxA(), id, "sent");
      ids.push(id);
    }
    await setStatus(ctxA(), ids[0]!, "accepted");
    await expectSqlError(
      setStatus(ctxA(), ids[1]!, "accepted"),
      "23505",
      "quotes_accepted_opportunity_key",
    );
  });

  it("las condiciones son inmutables: sin grant (42501) y, para el dueño, el trigger", async () => {
    const { id } = await freshQuote();
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.update(quotes).set({ totalPrice: "1.00" }).where(eq(quotes.id, id)),
      ),
      "42501",
    );
    await expect(
      db.admin`UPDATE public.quotes SET total_price = 1, status = 'withdrawn' WHERE id = ${id}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "quotes_immutable",
    });
    await expect(
      db.admin`UPDATE public.quotes SET status = 'approved' WHERE id = ${id}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "quotes_approval_requires_user",
    });
    await expect(
      db.admin`DELETE FROM public.opportunities WHERE id IN (SELECT opportunity_id FROM public.quotes WHERE id = ${id})`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("una cotización de otra organización no se mueve (RLS: 0 filas)", async () => {
    const foreign = await freshQuote(ctxB());
    const updated = await setStatus(ctxA(), foreign.id, "withdrawn");
    expect(updated).toHaveLength(0);
    expect((await rowOf(foreign.id)).status).toBe("draft");
  });
});

describe("el total del dominio es el del CHECK", () => {
  it("quoteTotal() coincide con el round() de numeric en PYG y USD", async () => {
    const cases: [string, "PYG" | "USD", string][] = [
      ["150000000.00", "PYG", "7.50"],
      ["149999999.00", "PYG", "12.35"],
      ["1005.00", "PYG", "0.50"],
      ["32990.50", "USD", "7.50"],
      ["33333.33", "USD", "29.99"],
      ["0.05", "USD", "10.00"],
      ["12345.67", "USD", "0.01"],
    ];
    for (const [list, currency, percent] of cases) {
      const [row] = await db.admin`
        SELECT round(${list}::numeric * (100 - ${percent}::numeric) / 100,
          CASE WHEN ${currency} = 'PYG' THEN 0 ELSE 2 END)::numeric(14, 2)::text AS total
      `;
      expect(
        quoteTotal(
          { amount: list, currency },
          { kind: "percent", value: percent },
        ).amount,
      ).toBe(row!.total);
    }
  });
});
