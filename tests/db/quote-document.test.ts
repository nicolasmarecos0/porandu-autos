import { randomUUID } from "node:crypto";

import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getQuoteDocumentPage } from "@/db/queries/quote-document";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { addDays } from "@/domains/quotes/request";
import { changeQuoteStatus, createQuote } from "@/lib/quotes/actions";
import { handleQuotePdf } from "@/lib/quotes/pdf-download";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { pdfText } from "../unit/support/pdf-text";
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
  ORG_3,
  seedTenants,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
} from "./support/tenants";

/*
 * Presupuesto en PDF (Hito 14, DEC-046) de punta a punta contra PostgreSQL
 * con las migraciones aplicadas:
 *
 *   página: getQuoteDocumentPage() → requireTenant() → withTenant() → la
 *   cotización de esa oportunidad en la organización activa, con su
 *   cliente, su unidad y el concesionario → RLS → dominio
 *
 *   descarga: handleQuotePdf() → resolveRequestTenant() → withTenant() →
 *   la misma lectura → regla de exportación → PDF
 *
 * Las cotizaciones se crean y se aprueban con las Server Actions reales
 * (Hito 10). La lectura y el generador son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en quote-actions.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3 · D: solo inactiva en ORG_1.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await db.admin`
    UPDATE public.organizations SET name = 'Automotores Lambaré' WHERE id = ${ORG_1}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(userId: string | null, cookie?: string): void {
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

const today = () => todayInAsuncion(new Date());

async function vehicle(organizationId: string): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version, year, km, status, price, currency)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux', 'SRV 2.8 4x4 AT', 2024, 32000, 'available', '49900.00', 'USD')
  `;
  return id;
}

let sequence = 0;

async function opportunity(organizationId: string): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  // Un teléfono por contacto: es su identidad en la organización (DEC-024).
  const digits = `981${String(sequence).padStart(6, "0")}`;
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name, phone, phone_normalized, city)
    VALUES (${contactId}, ${organizationId}, 'Ramón Benítez', ${`0${digits}`}, ${`+595${digits}`}, 'Asunción')
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage: "negotiating",
      source: "web",
      ...closureColumns("negotiating"),
    })}
  `;
  return id;
}

/** Una cotización de ORG_1 creada por A, opcionalmente aprobada. */
async function quote(
  approve: boolean,
  opportunityId?: string,
): Promise<{ quoteId: string; opportunityId: string }> {
  const opportunityOf = opportunityId ?? (await opportunity(ORG_1));
  const vehicleId = await vehicle(ORG_1);
  request(USER_A);
  const data = new FormData();
  for (const [name, value] of Object.entries({
    opportunityId: opportunityOf,
    vehicleId,
    discountKind: "percent",
    discountValue: "7,5",
    validUntil: addDays(today(), 7),
    notes: "Incluye transferencia.",
  })) {
    data.append(name, value);
  }
  const created = await createQuote(null, data);
  if (created?.status !== "created") throw new Error("quote not created");
  if (approve) {
    const change = new FormData();
    change.append("quoteId", created.quoteId);
    change.append("from", "draft");
    change.append("to", "approved");
    const changed = await changeQuoteStatus(null, change);
    if (changed?.status !== "changed") throw new Error("quote not approved");
  }
  return { quoteId: created.quoteId, opportunityId: opportunityOf };
}

async function stateOf(quoteId: string) {
  const [row] = await db.admin`
    SELECT q.status, q.updated_at, q.sent_at, o.last_activity_at, o.updated_at AS opportunity_updated_at
    FROM public.quotes q
    JOIN public.opportunities o ON o.organization_id = q.organization_id AND o.id = q.opportunity_id
    WHERE q.id = ${quoteId}
  `;
  return row!;
}

describe("página del presupuesto (getQuoteDocumentPage)", () => {
  it("arma el presupuesto con el concesionario, el cliente y la unidad de la base", async () => {
    const { quoteId, opportunityId } = await quote(true);
    request(USER_C, ORG_1);

    const page = await getQuoteDocumentPage(opportunityId, quoteId);

    expect(page).not.toBeNull();
    expect(page!.opportunityId).toBe(opportunityId);
    expect(page!.contactName).toBe("Ramón Benítez");
    expect(page!.quote).toMatchObject({
      id: quoteId,
      status: "approved",
      exportability: { exportable: true },
    });
    expect(page!.quotes.map((q) => q.id)).toContain(quoteId);
    expect(page!.document).toMatchObject({
      issuer: { name: "Automotores Lambaré", monogram: "AL" },
      customer: {
        name: "Ramón Benítez",
        fields: [{ label: "Ciudad", value: "Asunción" }],
      },
      vehicle: {
        name: "Toyota Hilux",
        fields: [
          { label: "Versión", value: "SRV 2.8 4x4 AT" },
          { label: "Año", value: "2024" },
          { label: "Kilometraje", value: "32.000 km" },
        ],
      },
      pricing: { total: "USD 46.157,50" },
      conditions: ["Incluye transferencia."],
    });
    // Ni el teléfono del cliente ni ids de usuario llegan a la página.
    expect(JSON.stringify(page)).not.toMatch(/0981|\+595/);
    expect(JSON.stringify(page)).not.toContain(USER_A);
  });

  it("un borrador se ve, con el motivo por el que no se descarga", async () => {
    const { quoteId, opportunityId } = await quote(false);
    request(USER_A);
    const page = await getQuoteDocumentPage(opportunityId, quoteId);
    expect(page!.quote.exportability).toEqual({
      exportable: false,
      reason: "draft",
    });
  });

  it("de otra organización, de otra oportunidad o con ids inválidos es null, sin distinguir", async () => {
    const { quoteId, opportunityId } = await quote(true);
    const otherOpportunity = await opportunity(ORG_1);

    // B solo es miembro de ORG_2.
    request(USER_B);
    expect(await getQuoteDocumentPage(opportunityId, quoteId)).toBeNull();
    // C con ORG_3 como organización activa: la membership en ORG_1 no alcanza.
    request(USER_C, ORG_3);
    expect(await getQuoteDocumentPage(opportunityId, quoteId)).toBeNull();
    // La cotización existe, pero no es de esa oportunidad.
    request(USER_A);
    expect(await getQuoteDocumentPage(otherOpportunity, quoteId)).toBeNull();
    expect(await getQuoteDocumentPage(opportunityId, "x")).toBeNull();
    expect(await getQuoteDocumentPage("x", quoteId)).toBeNull();
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const { quoteId, opportunityId } = await quote(true);
    request(null);
    expect(await redirectOf(getQuoteDocumentPage(opportunityId, quoteId))).toBe(
      "/login",
    );
    request(USER_D, ORG_1);
    expect(await redirectOf(getQuoteDocumentPage(opportunityId, quoteId))).toBe(
      "/no-access",
    );
  });
});

describe("descarga del PDF (GET /api/quotes/[quoteId]/pdf)", () => {
  it("una aprobada: el PDF con los datos de la base, para admin y seller", async () => {
    const { quoteId } = await quote(true);
    for (const [user, cookie] of [
      [USER_A, undefined],
      [USER_C, ORG_1],
    ] as const) {
      request(user, cookie);
      const response = await handleQuotePdf(quoteId);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="presupuesto-\d{4}-ramon-benitez\.pdf"$/,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = await pdfText(bytes);
      expect(text).toContain("Automotores Lambaré");
      expect(text).toContain("Ramón Benítez");
      expect(text).toContain("SRV 2.8 4x4 AT");
      expect(text).toContain("USD 46.157,50");
      expect(text).not.toMatch(/0981|\+595/);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(doc.getAuthor()).toBe("Automotores Lambaré");
    }
  });

  it("un borrador no se genera: 409 draft", async () => {
    const { quoteId } = await quote(false);
    request(USER_A);
    const response = await handleQuotePdf(quoteId);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "not_exportable",
      reason: "draft",
    });
  });

  it("una anulada no se genera: 409 withdrawn", async () => {
    const { quoteId } = await quote(true);
    request(USER_A);
    const data = new FormData();
    data.append("quoteId", quoteId);
    data.append("from", "approved");
    data.append("to", "withdrawn");
    expect(await changeQuoteStatus(null, data)).toMatchObject({
      status: "changed",
    });
    const response = await handleQuotePdf(quoteId);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "not_exportable",
      reason: "withdrawn",
    });
  });

  it("de otra organización es 404, igual que una inexistente", async () => {
    const { quoteId } = await quote(true);
    request(USER_B);
    expect((await handleQuotePdf(quoteId)).status).toBe(404);
    request(USER_C, ORG_3);
    expect((await handleQuotePdf(quoteId)).status).toBe(404);
    request(USER_A);
    expect((await handleQuotePdf(randomUUID())).status).toBe(404);
    expect((await handleQuotePdf("no-es-un-uuid")).status).toBe(404);
  });

  it("sin sesión es 401 y sin membership activa 403, sin redirects", async () => {
    const { quoteId } = await quote(true);
    request(null);
    expect((await handleQuotePdf(quoteId)).status).toBe(401);
    request(USER_D, ORG_1);
    expect((await handleQuotePdf(quoteId)).status).toBe(403);
    // C tiene dos memberships activas: sin elegir organización, 403.
    request(USER_C);
    expect((await handleQuotePdf(quoteId)).status).toBe(403);
  });

  it("descargar y ver no escriben nada: ni el estado, ni los sellos, ni la recencia", async () => {
    const { quoteId, opportunityId } = await quote(true);
    const before = await stateOf(quoteId);
    request(USER_A);
    expect((await handleQuotePdf(quoteId)).status).toBe(200);
    expect(await getQuoteDocumentPage(opportunityId, quoteId)).not.toBeNull();
    expect(await stateOf(quoteId)).toEqual(before);
    expect(before.status).toBe("approved");
    expect(before.sent_at).toBeNull();
  });

  it("ORG_2 con su propia cotización no ve la de ORG_1 ni al revés", async () => {
    const mine = await quote(true);
    // Una cotización de ORG_2, creada por su admin.
    const opportunityId = await opportunity(ORG_2);
    const vehicleId = await vehicle(ORG_2);
    request(USER_B);
    const data = new FormData();
    for (const [name, value] of Object.entries({
      opportunityId,
      vehicleId,
      discountKind: "none",
      discountValue: "",
      validUntil: addDays(today(), 7),
      notes: "",
    })) {
      data.append(name, value);
    }
    const created = await createQuote(null, data);
    if (created?.status !== "created") throw new Error("quote not created");

    request(USER_B);
    expect(
      await getQuoteDocumentPage(mine.opportunityId, mine.quoteId),
    ).toBeNull();
    const theirs = await getQuoteDocumentPage(opportunityId, created.quoteId);
    expect(theirs!.document.issuer.name).toBe("Organización 2");

    request(USER_A);
    expect(
      await getQuoteDocumentPage(opportunityId, created.quoteId),
    ).toBeNull();
    expect((await handleQuotePdf(created.quoteId)).status).toBe(404);
  });
});
