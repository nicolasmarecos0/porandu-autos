import type { Sql } from "postgres";

import { ORG_1, ORG_2, ORG_3 } from "./tenants";

/*
 * Contactos y oportunidades sintéticos para H1.1. Se insertan con el
 * superusuario y quedan committeados: withTenant() los lee por sus propias
 * conexiones. Usan las organizaciones de tenants.ts:
 *
 *   ORG_1: 3 oportunidades (A y C la ven) · ORG_2: 2 (B) · ORG_3: 1 (C).
 *
 * La recencia se fija contra NOW, el momento que se le pasa al loader.
 */

/** 10:30 en Asunción (UTC-3). */
export const NOW = new Date("2026-10-01T13:30:00Z");

type SeedOpportunity = {
  id: string;
  organizationId: string;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    city: string | null;
  };
  stage: "new" | "qualifying" | "negotiating" | "won" | "lost";
  source: "whatsapp" | "meta_ads" | "web" | "showroom" | "referral";
  interestModel: string | null;
  interestVersion: string | null;
  /** Minutos desde la última actividad, respecto de NOW. */
  minutes: number;
};

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const OPPORTUNITIES: SeedOpportunity[] = [
  {
    id: id(101),
    organizationId: ORG_1,
    contact: {
      id: id(1),
      name: "Ramón Benítez",
      phone: "0981 555 214",
      city: "Luque",
    },
    stage: "qualifying",
    source: "whatsapp",
    interestModel: "Toyota Hilux",
    interestVersion: "SRV 2.8 4x4 AT",
    minutes: 2,
  },
  {
    id: id(102),
    organizationId: ORG_1,
    contact: { id: id(2), name: "Celeste Báez", phone: null, city: null },
    stage: "new",
    source: "web",
    interestModel: null,
    interestVersion: null,
    minutes: 180,
  },
  {
    id: id(103),
    organizationId: ORG_1,
    // Mismo contacto, otra oportunidad.
    contact: {
      id: id(1),
      name: "Ramón Benítez",
      phone: "0981 555 214",
      city: "Luque",
    },
    stage: "qualifying",
    source: "showroom",
    interestModel: "Toyota Fortuner",
    interestVersion: null,
    minutes: 45,
  },
  {
    id: id(201),
    organizationId: ORG_2,
    contact: {
      id: id(3),
      name: "Fátima Giménez",
      phone: "+595 985 555 119",
      city: "Asunción",
    },
    stage: "negotiating",
    source: "referral",
    interestModel: "Kia Sportage",
    interestVersion: "2.0 EX AT",
    minutes: 10,
  },
  {
    id: id(202),
    organizationId: ORG_2,
    contact: {
      id: id(4),
      name: "Óscar Brítez",
      phone: "0983 555 846",
      city: "Villa Elisa",
    },
    stage: "new",
    source: "meta_ads",
    interestModel: "Hyundai Tucson",
    interestVersion: null,
    minutes: 1500,
  },
  {
    id: id(301),
    organizationId: ORG_3,
    contact: {
      id: id(5),
      name: "Agroganadera Santa Clara S.A.",
      phone: "0331 555 480",
      city: "Concepción",
    },
    stage: "negotiating",
    source: "referral",
    interestModel: "Toyota Hilux",
    interestVersion: "SR 2.8 4x4 MT",
    minutes: 38,
  },
];

/** Ids de las oportunidades de `organizationId`, en el orden de la cola. */
export function opportunityIdsOf(organizationId: string): string[] {
  return OPPORTUNITIES.filter((o) => o.organizationId === organizationId)
    .toSorted((a, b) => a.minutes - b.minutes)
    .map((o) => o.id);
}

/**
 * `initialOnly`: todas las oportunidades en `new`. Es lo que tiene una base
 * real antes de H1.6 (el alta nace en `new` y no había UPDATE) y lo único que
 * admite el CHECK de las migraciones 0002 a 0007 con las etapas de H1.6.
 */
export async function seedOpportunities(
  admin: Sql,
  options: { initialOnly?: boolean } = {},
): Promise<void> {
  const contacts = new Map(
    OPPORTUNITIES.map((o) => [
      o.contact.id,
      { ...o.contact, organization_id: o.organizationId },
    ]),
  );
  await admin.begin(async (tx) => {
    await tx`
      INSERT INTO public.contacts ${tx(
        [...contacts.values()].map((c) => ({
          id: c.id,
          organization_id: c.organization_id,
          name: c.name,
          phone: c.phone,
          city: c.city,
        })),
      )}
    `;
    await tx`
      INSERT INTO public.opportunities ${tx(
        OPPORTUNITIES.map((o) => ({
          id: o.id,
          organization_id: o.organizationId,
          contact_id: o.contact.id,
          stage: options.initialOnly ? "new" : o.stage,
          source: o.source,
          interest_model: o.interestModel,
          interest_version: o.interestVersion,
          last_activity_at: new Date(NOW.getTime() - o.minutes * 60_000),
        })),
      )}
    `;
  });
}
