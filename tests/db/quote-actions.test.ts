import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { addDays } from "@/domains/quotes/request";
import { changeQuoteStatus, createQuote } from "@/lib/quotes/actions";
import type {
  ChangeQuoteStatusState,
  CreateQuoteState,
} from "@/lib/quotes/requests";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { closureColumns } from "./support/closures";
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
  USER_A,
  USER_B,
  USER_C,
  USER_D,
} from "./support/tenants";

/*
 * Cotizaciones (Hito 10, DEC-042 §8 y §9) de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → leer el pedido → withTenant() →
 *   oportunidad cotizable y unidad con precio en la organización activa →
 *   validar contra esa lista → INSERT → número (trigger) + RLS + CHECKs →
 *   loader de /opportunities/[id]
 *
 *   Server Action → requireTenant() → withTenant() → fila bloqueada →
 *   estado esperado → plan del dominio con el rol → UPDATE → trigger
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en test-drives.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 · D: solo inactiva en ORG_1.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  return {
    RedirectSignal,
    claims: null as Record<string, unknown> | null,
    jar: null as CookieJar | null,
    revalidated: [] as string[],
    redirect: (path: string): never => {
      throw new RedirectSignal(path);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: async () => ({
    getClaims: async () =>
      mocks.claims
        ? { data: { claims: mocks.claims }, error: null }
        : { data: null, error: null },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    mocks.revalidated.push(path);
  },
}));

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

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(userId: string | null, cookie?: string): void {
  mocks.revalidated.length = 0;
  mocks.claims = userId
    ? {
        iss: "https://testref.supabase.co/auth/v1",
        sub: userId,
        aud: "authenticated",
        exp: 1_900_000_000,
        iat: 1_899_996_400,
        role: "authenticated",
        aal: "aal1",
        session_id: "00000000-0000-4000-8000-0000000000e1",
      }
    : null;
  mocks.jar = cookieJar(
    cookie === undefined ? {} : { [ACTIVE_ORGANIZATION_COOKIE]: cookie },
  );
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

let sequence = 0;

async function vehicle(
  organizationId: string,
  status: "in_preparation" | "available" | "reserved" | "sold" = "available",
  price: string | null = "50000.00",
  currency: "USD" | "PYG" | null = "USD",
): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, year, status, price, currency)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux', 2024, ${status}, ${price}, ${currency})
  `;
  return id;
}

async function opportunity(
  organizationId: string,
  stage: "new" | "qualifying" | "negotiating" | "won" | "lost" = "negotiating",
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

const today = () => todayInAsuncion(new Date());

function createForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    discountKind: "none",
    discountValue: "",
    validUntil: addDays(today(), 7),
    notes: "",
    ...fields,
  })) {
    data.append(name, value);
  }
  return data;
}

function create(fields: Record<string, string>): Promise<CreateQuoteState> {
  return createQuote(null, createForm(fields));
}

function change(
  quoteId: string,
  from: string,
  to: string,
): Promise<ChangeQuoteStatusState> {
  const data = new FormData();
  data.append("quoteId", quoteId);
  data.append("from", from);
  data.append("to", to);
  return changeQuoteStatus(null, data);
}

async function rowOf(id: string) {
  const [row] = await db.admin`
    SELECT organization_id, created_by, status, number, list_price::text,
      currency, discount_kind, discount_value::text, total_price::text,
      valid_until::text, notes, approved_by
    FROM public.quotes WHERE id = ${id}
  `;
  return row!;
}

describe("crear (createQuote)", () => {
  it("admin y seller crean en Borrador, con la lista de la unidad y el total calculado", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1, "available", "32990.50", "USD");
    request(USER_C, ORG_1);

    const state = await create({
      opportunityId,
      vehicleId,
      discountKind: "percent",
      discountValue: "7,5",
      notes: "  Incluye   transferencia. ",
    });

    expect(state).toMatchObject({ status: "created" });
    const quoteId = state?.status === "created" ? state.quoteId : "";
    expect(await rowOf(quoteId)).toMatchObject({
      organization_id: ORG_1,
      created_by: USER_C,
      status: "draft",
      list_price: "32990.50",
      currency: "USD",
      discount_kind: "percent",
      discount_value: "7.50",
      total_price: "30516.21",
      notes: "Incluye transferencia.",
    });
    expect(mocks.revalidated).toEqual([`/opportunities/${opportunityId}`]);
  });

  it("la oportunidad y la unidad tienen que ser de la organización activa, sin revelar si existen", async () => {
    const foreignOpportunity = await opportunity(ORG_2);
    const foreignVehicle = await vehicle(ORG_2);
    request(USER_A);

    expect(
      await create({
        opportunityId: foreignOpportunity,
        vehicleId: await vehicle(ORG_1),
      }),
    ).toMatchObject({ status: "opportunity_unavailable" });
    expect(
      await create({
        opportunityId: await opportunity(ORG_1),
        vehicleId: foreignVehicle,
      }),
    ).toMatchObject({
      status: "invalid",
      errors: { vehicleId: "unavailable" },
    });
    expect(mocks.revalidated).toEqual([]);
  });

  it("solo calificando o negociando, unidades en stock y con precio publicado", async () => {
    request(USER_A);
    for (const stage of ["new", "won", "lost"] as const) {
      expect(
        await create({
          opportunityId: await opportunity(ORG_1, stage),
          vehicleId: await vehicle(ORG_1),
        }),
      ).toMatchObject({ status: "opportunity_unavailable" });
    }
    expect(
      await create({
        opportunityId: await opportunity(ORG_1),
        vehicleId: await vehicle(ORG_1, "sold"),
      }),
    ).toMatchObject({ errors: { vehicleId: "unavailable" } });
    expect(
      await create({
        opportunityId: await opportunity(ORG_1),
        vehicleId: await vehicle(ORG_1, "available", null, null),
      }),
    ).toMatchObject({ errors: { vehicleId: "without_price" } });
  });

  it("valida el descuento contra la lista real: tope, PYG sin decimales y validez", async () => {
    request(USER_A);
    const opportunityId = await opportunity(ORG_1);
    const pyg = await vehicle(ORG_1, "available", "150000000.00", "PYG");
    expect(
      await create({
        opportunityId,
        vehicleId: pyg,
        discountKind: "amount",
        discountValue: "1000,50",
      }),
    ).toMatchObject({ errors: { discountValue: "pyg_decimals" } });
    expect(
      await create({
        opportunityId,
        vehicleId: pyg,
        discountKind: "percent",
        discountValue: "31",
      }),
    ).toMatchObject({ errors: { discountValue: "too_large" } });
    expect(
      await create({
        opportunityId,
        vehicleId: pyg,
        validUntil: addDays(today(), 31),
      }),
    ).toMatchObject({ errors: { validUntil: "too_far" } });
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    request(null);
    expect(await redirectOf(create({ opportunityId, vehicleId }))).toBe(
      "/login",
    );
    request(USER_D, ORG_1);
    expect(await redirectOf(create({ opportunityId, vehicleId }))).toBe(
      "/no-access",
    );
    const [count] = await db.admin`
      SELECT count(*)::int AS count FROM public.quotes
      WHERE opportunity_id = ${opportunityId}
    `;
    expect(count!.count).toBe(0);
  });
});

async function freshQuote(
  discount: Record<string, string> = {},
): Promise<{ quoteId: string; opportunityId: string; vehicleId: string }> {
  const opportunityId = await opportunity(ORG_1);
  const vehicleId = await vehicle(ORG_1);
  request(USER_A);
  const state = await create({ opportunityId, vehicleId, ...discount });
  if (state?.status !== "created") throw new Error("quote not created");
  return { quoteId: state.quoteId, opportunityId, vehicleId };
}

describe("cambiar el estado (changeQuoteStatus)", () => {
  it("recorre el ciclo: aprobar, enviar, aceptar; revalida el detalle", async () => {
    const { quoteId, opportunityId } = await freshQuote();
    request(USER_C, ORG_1);
    expect(await change(quoteId, "draft", "approved")).toEqual({
      status: "changed",
      quoteId,
      to: "approved",
    });
    expect((await rowOf(quoteId)).approved_by).toBe(USER_C);
    expect(await change(quoteId, "approved", "sent")).toMatchObject({
      status: "changed",
    });
    expect(await change(quoteId, "sent", "accepted")).toMatchObject({
      status: "changed",
      to: "accepted",
    });
    expect(mocks.revalidated).toContain(`/opportunities/${opportunityId}`);
  });

  it("un seller no aprueba más del 10 %; un admin sí", async () => {
    const { quoteId } = await freshQuote({
      discountKind: "percent",
      discountValue: "12",
    });
    request(USER_C, ORG_1);
    expect(await change(quoteId, "draft", "approved")).toEqual({
      status: "requires_admin",
    });
    expect((await rowOf(quoteId)).status).toBe("draft");
    request(USER_A);
    expect(await change(quoteId, "draft", "approved")).toMatchObject({
      status: "changed",
    });
  });

  it("nada se envía sin aprobar, y una segunda aceptada en la misma oportunidad se rechaza", async () => {
    const first = await freshQuote();
    request(USER_A);
    expect(await change(first.quoteId, "draft", "sent")).toEqual({
      status: "invalid_transition",
    });

    const vehicleId = await vehicle(ORG_1);
    const second = await create({
      opportunityId: first.opportunityId,
      vehicleId,
    });
    const secondId = second?.status === "created" ? second.quoteId : "";
    for (const id of [first.quoteId, secondId]) {
      await change(id, "draft", "approved");
      await change(id, "approved", "sent");
    }
    expect(await change(first.quoteId, "sent", "accepted")).toMatchObject({
      status: "changed",
    });
    expect(await change(secondId, "sent", "accepted")).toEqual({
      status: "already_accepted",
    });
    expect((await rowOf(secondId)).status).toBe("sent");
  });

  it("compare-and-set: si otra persona ya la movió, es unchanged con el estado real", async () => {
    const { quoteId } = await freshQuote();
    request(USER_A);
    await change(quoteId, "draft", "withdrawn");
    request(USER_C, ORG_1);
    expect(await change(quoteId, "draft", "approved")).toEqual({
      status: "unchanged",
      quoteId,
      current: "withdrawn",
    });
  });

  it("con la oportunidad cerrada solo se rechaza o anula", async () => {
    const { quoteId, opportunityId } = await freshQuote();
    await db.admin`
      UPDATE public.opportunities SET stage = 'lost', loss_reason = 'price'
      WHERE id = ${opportunityId}
    `;
    request(USER_A);
    expect(await change(quoteId, "draft", "approved")).toEqual({
      status: "opportunity_closed",
    });
    expect(await change(quoteId, "draft", "withdrawn")).toMatchObject({
      status: "changed",
    });
  });

  it("una cotización de otra organización, inexistente o un pedido inválido es not_found", async () => {
    const opportunityId = await opportunity(ORG_2);
    const vehicleId = await vehicle(ORG_2);
    request(USER_B);
    const foreign = await create({ opportunityId, vehicleId });
    const foreignId = foreign?.status === "created" ? foreign.quoteId : "";

    request(USER_A);
    expect(await change(foreignId, "draft", "withdrawn")).toEqual({
      status: "not_found",
    });
    expect(await change(randomUUID(), "draft", "withdrawn")).toEqual({
      status: "not_found",
    });
    expect(await change("nope", "draft", "withdrawn")).toEqual({
      status: "not_found",
    });
    expect((await rowOf(foreignId)).status).toBe("draft");
  });
});

describe("loader de /opportunities/[id]", () => {
  it("arma el panel: cotizaciones, unidades cotizables, acciones por rol y total aceptado", async () => {
    const { quoteId, opportunityId, vehicleId } = await freshQuote({
      discountKind: "percent",
      discountValue: "12",
    });

    request(USER_C, ORG_1);
    const asSeller = await getOpportunityDetail(opportunityId);
    const card = asSeller!.quotes.quotes.find((quote) => quote.id === quoteId);
    expect(card).toMatchObject({
      status: "draft",
      transitions: ["withdrawn"],
      requiresAdmin: true,
      totalLabel: "USD 44.000",
    });
    expect(asSeller!.quotes.canCreate).toBe(true);
    expect(
      asSeller!.quotes.vehicleOptions.some((option) => option.id === vehicleId),
    ).toBe(true);
    expect(asSeller!.quotes.acceptedTotal).toBeNull();

    request(USER_A);
    await change(quoteId, "draft", "approved");
    await change(quoteId, "approved", "sent");
    await change(quoteId, "sent", "accepted");
    const asAdmin = await getOpportunityDetail(opportunityId);
    expect(asAdmin!.quotes.acceptedTotal).toEqual({
      amount: "44000.00",
      currency: "USD",
    });
  });

  it("no muestra cotizaciones de otra organización ni unidades sin precio", async () => {
    const opportunityId = await opportunity(ORG_1);
    const withoutPrice = await vehicle(ORG_1, "available", null, null);
    const foreignVehicle = await vehicle(ORG_2);
    request(USER_A);
    const detail = await getOpportunityDetail(opportunityId);
    const ids = detail!.quotes.vehicleOptions.map((option) => option.id);
    expect(ids).not.toContain(withoutPrice);
    expect(ids).not.toContain(foreignVehicle);
    expect(detail!.quotes.quotes).toEqual([]);
  });
});
