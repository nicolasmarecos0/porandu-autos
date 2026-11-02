import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/quotes/[quoteId]/pdf/route";
import type { TenantContext } from "@/db/tenant";
import type { QuoteDocumentSource } from "@/domains/quotes/document";
import { handleQuotePdf } from "@/lib/quotes/pdf-download";
import type { RequestTenant } from "@/lib/tenant/session";

/*
 * GET /api/quotes/[quoteId]/pdf (Hito 14, DEC-046 §5) sin base de datos:
 * tenant, regla de exportación decidida en el servidor, respuesta del PDF y
 * lo que se registra en los logs, con la lectura simulada. El generador es
 * el real. Contra PostgreSQL (aislamiento de tenant y la lectura de punta
 * a punta): tests/db/quote-document.test.ts. Valores ficticios.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestTenant: vi.fn<() => Promise<unknown>>(),
  getQuotePdfSource:
    vi.fn<(ctx: unknown, quoteId: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/tenant/session", () => ({
  resolveRequestTenant: mocks.resolveRequestTenant,
}));
vi.mock("@/db/queries/quote-document", () => ({
  getQuotePdfSource: mocks.getQuotePdfSource,
}));

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000c";
const QUOTE = "30000000-0000-4000-8000-000000000007";

// La lectura está simulada: el contexto solo viaja.
const ctx = {
  userId: USER,
  organizationId: ORG,
  role: "seller",
  claims: { sub: USER, role: "authenticated" },
} as unknown as TenantContext;

function source(
  overrides: Partial<QuoteDocumentSource> = {},
): QuoteDocumentSource {
  return {
    number: 7,
    status: "approved",
    currency: "USD",
    listPrice: "49900.00",
    discountKind: "none",
    discountValue: null,
    totalPrice: "49900.00",
    // Lejos en el futuro: la validez no depende del día en que corre el test.
    validUntil: "2099-12-31",
    notes: null,
    createdAt: new Date("2026-11-01T13:02:00Z"),
    opportunityStage: "negotiating",
    organizationName: "Automotores Lambaré",
    customerName: "Ramón Benítez",
    customerCity: null,
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleVersion: null,
    vehicleYear: 2024,
    vehicleKm: null,
    ...overrides,
  };
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveRequestTenant.mockResolvedValue({
    kind: "resolved",
    context: ctx,
  } satisfies RequestTenant);
  mocks.getQuotePdfSource.mockResolvedValue(source());
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function errorOf(response: Response) {
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return { status: response.status, body: await response.json() };
}

describe("ruta", () => {
  it("solo exporta GET, en runtime Node, y delega con el id de la URL", async () => {
    expect(route.runtime).toBe("nodejs");
    expect(Object.keys(route).sort()).toEqual(["GET", "runtime"]);
    const response = await route.GET(
      new Request(`https://app.porandu.test/api/quotes/${QUOTE}/pdf`),
      { params: Promise.resolve({ quoteId: QUOTE }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.getQuotePdfSource).toHaveBeenCalledWith(ctx, QUOTE);
  });
});

describe("handleQuotePdf()", () => {
  it("una cotización aprobada y vigente: el PDF como adjunto, sin caché compartida", async () => {
    const response = await handleQuotePdf(QUOTE);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="presupuesto-0007-ramon-benitez.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(
      String(bytes.byteLength),
    );
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe("Presupuesto N.º 0007");
  });

  it.each(["sent", "accepted"] as const)(
    "también se descarga una %s",
    async (status) => {
      mocks.getQuotePdfSource.mockResolvedValue(source({ status }));
      expect((await handleQuotePdf(QUOTE)).status).toBe(200);
    },
  );

  it("una aceptada se descarga aunque haya vencido y la oportunidad esté ganada", async () => {
    mocks.getQuotePdfSource.mockResolvedValue(
      source({
        status: "accepted",
        validUntil: "2020-01-01",
        opportunityStage: "won",
      }),
    );
    expect((await handleQuotePdf(QUOTE)).status).toBe(200);
  });

  it.each([
    [{ status: "draft" }, "draft"],
    [{ status: "withdrawn" }, "withdrawn"],
    [{ status: "rejected" }, "rejected"],
    [{ status: "approved", validUntil: "2020-01-01" }, "expired"],
    [{ status: "sent", opportunityStage: "lost" }, "opportunity_closed"],
  ] as const)(
    "%o no se exporta: 409 con el motivo y sin generar nada",
    async (overrides, reason) => {
      mocks.getQuotePdfSource.mockResolvedValue(source(overrides));
      expect(await errorOf(await handleQuotePdf(QUOTE))).toEqual({
        status: 409,
        body: { error: "not_exportable", reason },
      });
    },
  );

  it("sin usuario verificado: 401, sin leer la base", async () => {
    mocks.resolveRequestTenant.mockResolvedValue({
      kind: "unauthenticated",
    } satisfies RequestTenant);
    expect(await errorOf(await handleQuotePdf(QUOTE))).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
    expect(mocks.getQuotePdfSource).not.toHaveBeenCalled();
  });

  it.each(["no-access", "select-organization"] as const)(
    "sin organización resuelta (%s): 403, sin leer la base",
    async (kind) => {
      mocks.resolveRequestTenant.mockResolvedValue({ kind } as RequestTenant);
      expect(await errorOf(await handleQuotePdf(QUOTE))).toEqual({
        status: 403,
        body: { error: "forbidden" },
      });
      expect(mocks.getQuotePdfSource).not.toHaveBeenCalled();
    },
  );

  it("de otra organización, inexistente o con un id inválido: 404 sin distinguir", async () => {
    mocks.getQuotePdfSource.mockResolvedValue(null);
    for (const id of [QUOTE, "no-es-un-uuid"]) {
      expect(await errorOf(await handleQuotePdf(id))).toEqual({
        status: 404,
        body: { error: "not_found" },
      });
    }
  });

  it("una falla de la base: 500 y el log sin datos de la cotización", async () => {
    mocks.getQuotePdfSource.mockRejectedValue(
      Object.assign(new Error("select ... Ramón Benítez"), {
        cause: { code: "57014", detail: "Ramón Benítez" },
      }),
    );
    expect(await errorOf(await handleQuotePdf(QUOTE))).toEqual({
      status: 500,
      body: { error: "failed" },
    });
    expect(errors).toHaveBeenCalledWith("[quotes] pdf read failed", {
      name: "Error",
      code: "57014",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("Ramón");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(QUOTE);
  });
});
