import type { Sql } from "postgres";

import { ORG_1, ORG_2, ORG_3 } from "./tenants";

/*
 * Vehículos sintéticos para H1.3A. Se insertan con el superusuario (en
 * H1.3A no hay alta de vehículos) y quedan committeados: withTenant() los lee
 * por sus propias conexiones. Usan las organizaciones de tenants.ts:
 *
 *   ORG_1: 3 vehículos (A y C los ven) · ORG_2: 2 (B) · ORG_3: 1 (C).
 *
 * En ORG_1, dos unidades ingresaron en el mismo instante: el id desempata.
 */

export type SeedVehicle = {
  id: string;
  organizationId: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
  price: string | null;
  currency: "PYG" | "USD" | null;
  status: "in_preparation" | "available" | "reserved" | "sold";
  /** Ingreso (`created_at`). */
  createdAt: Date;
};

const id = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const at = (iso: string) => new Date(iso);

export const VEHICLES: SeedVehicle[] = [
  {
    id: id(101),
    organizationId: ORG_1,
    brand: "Toyota",
    model: "Hilux",
    version: "SRV 2.8 4x4 AT",
    year: 2025,
    km: 0,
    price: "49900.00",
    currency: "USD",
    status: "available",
    createdAt: at("2026-09-30T14:00:00Z"),
  },
  {
    id: id(103),
    organizationId: ORG_1,
    brand: "Hyundai",
    model: "HB20",
    version: null,
    year: 2019,
    km: null,
    price: null,
    currency: null,
    status: "in_preparation",
    createdAt: at("2026-09-28T12:00:00Z"),
  },
  {
    id: id(102),
    organizationId: ORG_1,
    brand: "Toyota",
    model: "Corolla Cross",
    version: "XEI Hybrid 1.8",
    year: 2023,
    km: 48000,
    price: "28290.00",
    currency: "USD",
    status: "reserved",
    createdAt: at("2026-09-28T12:00:00Z"),
  },
  {
    id: id(201),
    organizationId: ORG_2,
    brand: "Kia",
    model: "Sportage",
    version: "2.0 EX AT",
    year: 2025,
    km: 0,
    price: "245000000.00",
    currency: "PYG",
    status: "available",
    createdAt: at("2026-10-01T11:30:00Z"),
  },
  {
    id: id(202),
    organizationId: ORG_2,
    brand: "Nissan",
    model: "Frontier",
    version: "XE 2.3 4x4 MT",
    year: 2021,
    km: 72000,
    price: "32990.50",
    currency: "USD",
    status: "sold",
    createdAt: at("2026-09-21T09:00:00Z"),
  },
  {
    id: id(301),
    organizationId: ORG_3,
    brand: "Mitsubishi",
    model: "L200 Triton",
    version: "GLS 2.4 4x4 MT",
    year: 2025,
    km: 0,
    price: "42900.00",
    currency: "USD",
    status: "available",
    createdAt: at("2026-09-29T16:45:00Z"),
  },
];

/**
 * Ids de los vehículos de `organizationId`, en el orden de la Stock List:
 * ingreso más reciente primero y, a igual ingreso, por id.
 */
export function vehicleIdsOf(organizationId: string): string[] {
  return VEHICLES.filter((v) => v.organizationId === organizationId)
    .toSorted(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((v) => v.id);
}

export async function seedVehicles(admin: Sql): Promise<void> {
  await admin`
    INSERT INTO public.vehicles ${admin(
      VEHICLES.map((v) => ({
        id: v.id,
        organization_id: v.organizationId,
        brand: v.brand,
        model: v.model,
        version: v.version,
        year: v.year,
        km: v.km,
        price: v.price,
        currency: v.currency,
        status: v.status,
        created_at: v.createdAt,
        updated_at: v.createdAt,
      })),
    )}
  `;
}
