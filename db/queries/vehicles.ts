import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import type { MatchCandidate } from "@/domains/match/presentation";
import type { StockVehicle, VehicleStatus } from "@/domains/vehicles/stock";
import { requireTenant } from "@/lib/tenant/session";

import { vehicles } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";

/*
 * Stock List desde PostgreSQL (H1.3A). Es la única fuente de la lista: no
 * hay fixtures de stock en runtime.
 *
 *   request → requireTenant() → TenantContext → withTenant() → query con
 *   filtro explícito por organización → RLS → ViewModel de Stock
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es solo
 *   un gate de UX: este loader pide su propio contexto.
 * - withTenant() corre la lectura como `authenticated` con los claims de la
 *   request; RLS deja ver solo organizaciones con membership activa.
 * - El filtro por `ctx.organizationId` es defensa en profundidad (ADR-001
 *   §2): con varias memberships activas, RLS deja ver todas sus
 *   organizaciones y el filtro deja solo la activa.
 *
 * Solo lectura: H1.3A no tiene alta ni edición de vehículos. Lo que la base
 * no tiene (fotos reales, matches, interesados, demanda) no se inventa.
 */

type VehicleRecord = typeof vehicles.$inferSelect;

export const statusFromDb: Record<VehicleRecord["status"], VehicleStatus> = {
  in_preparation: "inPreparation",
  available: "available",
  reserved: "reserved",
  sold: "sold",
};

/** Lo que la lista lee de la base: solo lo persistido que muestra la UI. */
export type StockRow = Readonly<
  Pick<
    VehicleRecord,
    | "id"
    | "brand"
    | "model"
    | "version"
    | "year"
    | "km"
    | "price"
    | "currency"
    | "status"
  >
>;

function selectStock(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<StockRow[]> {
  return tx
    .select({
      id: vehicles.id,
      brand: vehicles.brand,
      model: vehicles.model,
      version: vehicles.version,
      year: vehicles.year,
      km: vehicles.km,
      price: vehicles.price,
      currency: vehicles.currency,
      status: vehicles.status,
    })
    .from(vehicles)
    .where(eq(vehicles.organizationId, organizationId))
    .orderBy(desc(vehicles.createdAt), asc(vehicles.id));
}

/** Texto opcional: vacío o en blanco es "sin dato". */
function present(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Fila persistida → ViewModel de la Stock List. Pura. El precio viaja como
 * el texto decimal de la base (exacto) y solo con su moneda: la base exige
 * que vayan juntos.
 */
export function toStockVehicle(row: StockRow): StockVehicle {
  const version = present(row.version);
  return {
    id: row.id,
    brand: row.brand.trim(),
    model: row.model.trim(),
    ...(version ? { version } : {}),
    year: row.year,
    ...(row.km === null ? {} : { km: row.km }),
    ...(row.price !== null && row.currency !== null
      ? { price: { amount: row.price, currency: row.currency } }
      : {}),
    status: statusFromDb[row.status],
  };
}

/**
 * Loader de la página /stock: las unidades de la organización activa, del
 * ingreso más reciente al más viejo (a igual ingreso, por id).
 */
export async function getStockList(): Promise<readonly StockVehicle[]> {
  const ctx = await requireTenant();
  const rows = await withTenant(ctx, (tx) =>
    selectStock(tx, ctx.organizationId),
  );
  return rows.map(toStockVehicle);
}

/*
 * Candidatas de Match v0 (H1.5, DEC-031 §5): las unidades disponibles de la
 * organización activa. Corre dentro de la transacción withTenant() que ya
 * abrió quien llama (el loader de /opportunities/[id]) y filtra por la
 * organización del contexto y por `status = 'available'` en la base: RLS y
 * el filtro explícito son capas complementarias, y el motor vuelve a exigir
 * una sola organización y unidades disponibles.
 *
 * Mismo orden que la Stock List: un empate de puntaje conserva el ingreso
 * más reciente primero.
 */
type MatchRow = StockRow & Readonly<Pick<VehicleRecord, "organizationId">>;

function selectAvailable(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<MatchRow[]> {
  return tx
    .select({
      id: vehicles.id,
      organizationId: vehicles.organizationId,
      brand: vehicles.brand,
      model: vehicles.model,
      version: vehicles.version,
      year: vehicles.year,
      km: vehicles.km,
      price: vehicles.price,
      currency: vehicles.currency,
      status: vehicles.status,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.organizationId, organizationId),
        eq(vehicles.status, "available"),
      ),
    )
    .orderBy(desc(vehicles.createdAt), asc(vehicles.id));
}

/** Fila persistida → unidad candidata de Match. Pura. */
export function toMatchCandidate(row: MatchRow): MatchCandidate {
  const { price, ...unit } = toStockVehicle(row);
  return { ...unit, organizationId: row.organizationId, price: price ?? null };
}

/** Unidades disponibles de `organizationId`, como candidatas de Match. */
export async function selectMatchCandidates(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<MatchCandidate[]> {
  const rows = await selectAvailable(tx, organizationId);
  return rows.map(toMatchCandidate);
}
