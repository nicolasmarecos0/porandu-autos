import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";

/*
 * Estados de vehículo (TB §10): el mínimo que exige P1. Retirado/baja es
 * opcional y necesita un caso real de piloto. No es un enum de Postgres: un
 * CHECK que una migración puede reemplazar. El alta rápida (H1.3B) nace
 * siempre en `in_preparation`; las transiciones son la máquina del Hito 19
 * (propuesta DEC-051, domains/vehicles/lifecycle.ts): `in_preparation →
 * available`, `available ⇄ reserved` y `available | reserved → sold`, este
 * último solo al cerrar Ganada la oportunidad que tiene la unidad
 * vinculada. `sold` es terminal.
 */
export const vehicleStatuses = [
  "in_preparation",
  "available",
  "reserved",
  "sold",
] as const;

/*
 * Moneda del precio publicado: las que usa hoy el mercado de P1 (Paraguay).
 * Mismo criterio: CHECK reemplazable. No hay conversión entre monedas.
 */
export const vehicleCurrencies = ["PYG", "USD"] as const;

/*
 * Unidad del inventario de una organización (TB §10, "vehicles"): lo mínimo
 * que muestra la Stock List con datos reales (H1.3A). Es tenant-scoped
 * (ADR-001 §3.6): `organization_id` NOT NULL, con FK a `organizations` e
 * índice que empieza por `organization_id`.
 *
 * - `brand` / `model`: identificación de la unidad, obligatorias.
 *   `version`: opcional (texto libre, como `interest_version`).
 * - `year`: año modelo, obligatorio (1900–2100).
 * - `km`: opcional; 0 es una unidad 0 km, NULL es sin dato. Nunca negativo.
 * - `price` / `currency`: precio publicado. `numeric(14, 2)`: exacto, nunca
 *   float (Drizzle lo lee como texto). Van juntos: o los dos o ninguno (una
 *   unidad en preparación puede no tener precio todavía). Positivo, y en
 *   guaraníes sin decimales (PYG no tiene unidad menor).
 * - `status`: obligatorio y sin default, con CHECK.
 * - Índice (organization_id, created_at DESC): la lista de una
 *   organización, del ingreso más reciente al más viejo.
 * - unique (organization_id, id) (Hito 2, DEC-033): destino de la FK
 *   compuesta de la unidad vinculada a una oportunidad
 *   (`opportunities.vehicle_id`), que impide vincular una unidad de otra
 *   organización.
 * - Borrar una organización con vehículos se rechaza (RESTRICT).
 *
 * No se persisten fotos (vehicle_media), sucursal, matches, interesados,
 * trade-in, entrega/financiación ni datos técnicos: no tienen fuente ni
 * consumidor todavía (H1.3A, H1.3B).
 *
 * Lectura (H1.3A) y alta rápida (H1.3B): los vehículos de las organizaciones
 * donde el usuario tiene membership activa. Toda alta nace en
 * `in_preparation`: lo fija el código (nunca el cliente) y lo exige el WITH
 * CHECK de la policy de INSERT. El CHECK de `status` sigue admitiendo todos
 * los estados.
 *
 * Ciclo de vida (H1.3C, Hito 19): la única edición es el estado.
 * `authenticated` solo puede actualizar `status` y `updated_at` (grant por
 * columna, 0006) y hay una única policy de UPDATE tenant-scoped
 * (`vehicles_update_status`: organización con membership activa, antes y
 * después). Qué pase es válido lo decide el trigger BEFORE UPDATE
 * `vehicles_status_transition` (migración 0020, drizzle-kit no modela
 * triggers), que espeja la máquina del dominio, deja inmutable el resto de
 * la fila (también para el rol dueño), solo deja vender una unidad
 * vinculada a una oportunidad ganada y fija `updated_at`. Como las policies
 * permisivas de un mismo comando se combinan con OR (DEC-028 §5), los pares
 * viven en el trigger y no en policies por transición. Sin DELETE (default
 * deny).
 */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    version: text("version"),
    year: smallint("year").notNull(),
    km: integer("km"),
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency", { enum: vehicleCurrencies }),
    status: text("status", { enum: vehicleStatuses }).notNull(),
    ...timestamps,
  },
  (t) => [
    // Mismo orden que la query de la Stock List (DESC, que en Postgres es
    // NULLS FIRST).
    index("vehicles_organization_id_created_at_idx").on(
      t.organizationId,
      t.createdAt.desc().nullsFirst(),
    ),
    unique("vehicles_organization_id_id_key").on(t.organizationId, t.id),
    check("vehicles_status_check", oneOf(t.status, vehicleStatuses)),
    check("vehicles_currency_check", oneOf(t.currency, vehicleCurrencies)),
    check(
      "vehicles_price_check",
      sql`(${t.price} IS NULL) = (${t.currency} IS NULL) AND (${t.price} IS NULL OR (${t.price} > 0 AND (${t.currency} <> 'PYG' OR ${t.price} = trunc(${t.price}))))`,
    ),
    check("vehicles_year_check", sql`${t.year} BETWEEN 1900 AND 2100`),
    check("vehicles_km_check", sql`${t.km} IS NULL OR ${t.km} >= 0`),
    pgPolicy("vehicles_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: organización con membership activa y siempre en preparación.
    // La regla de alta es membership activa AND role IN ('admin', 'seller'):
    // equivalente hoy porque membership_role es exactamente admin | seller
    // (un test lo vigila). Los cambios de estado los valida el trigger.
    pgPolicy("vehicles_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.status} = 'in_preparation'`,
    }),
    // Ciclo de vida (Hito 19, propuesta DEC-051; reemplaza la policy de
    // H1.3C, vehicles_update_mark_available): organización con membership
    // activa, antes y después (misma regla de rol que el alta). Qué pase de
    // estado es válido lo decide el trigger vehicles_status_transition de
    // la migración 0020, no esta policy (DEC-028 §5 y §6, como DEC-032 §4
    // para las oportunidades).
    pgPolicy("vehicles_update_status", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
