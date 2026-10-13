import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { insertOpportunityMessage } from "@/db/queries/record-message";
import { MESSAGE_MAX_LENGTH } from "@/domains/conversations/messages";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import { addMessage } from "@/lib/conversations/actions";
import type { AddMessageState } from "@/lib/conversations/message";
import { addOpportunityNote } from "@/lib/opportunities/actions";
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
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  USER_E,
} from "./support/tenants";

/*
 * Registro de mensajes (Hito 4, DEC-036 §6) de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → leer y validar (Zod) → withTenant() →
 *   la oportunidad en la organización activa y su contacto → INSERT
 *   append-only → RLS (WITH CHECK) + FKs compuestas + CHECKs → trigger de
 *   actividad → loaders del detalle (muro) y de la cola (recencia)
 *
 * La acción, la escritura y los loaders son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en opportunity-notes.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
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

const DAY = 86_400_000;
let sequence = 0;

/**
 * Una oportunidad propia del caso, en `stage`, con su última actividad (y
 * su última edición) hace `daysAgo` días. Cerrada, trae metadatos de cierre
 * válidos, y `won`, su unidad (DEC-034).
 */
async function opportunity(
  organizationId: string,
  stage: Stage = "negotiating",
  daysAgo = 1,
): Promise<{ id: string; contactId: string }> {
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
    VALUES (${contactId}, ${organizationId}, ${`Prueba mensajes ${sequence}`})
  `;
  const at = new Date(Date.now() - daysAgo * DAY);
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      vehicle_id: vehicleId,
      source: "whatsapp",
      ...closureColumns(stage),
      last_activity_at: at,
      created_at: at,
      updated_at: at,
    })}
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

/** Los mensajes de una oportunidad tal como están en la base (sin RLS). */
async function messagesOf(opportunityId: string): Promise<MessageRecord[]> {
  return db.admin<MessageRecord[]>`
    SELECT id, organization_id AS "organizationId", contact_id AS "contactId",
      opportunity_id AS "opportunityId", channel, direction, content,
      recorded_by AS "recordedBy", created_at AS "createdAt"
    FROM public.messages WHERE opportunity_id = ${opportunityId}
    ORDER BY created_at, id
  `;
}

/** La oportunidad tal como está en la base (sin RLS). */
async function opportunityRow(id: string) {
  const [found] = await db.admin<
    {
      stage: string;
      vehicleId: string | null;
      lastActivityAt: Date;
      updatedAt: Date;
    }[]
  >`
    SELECT stage, vehicle_id AS "vehicleId", last_activity_at AS "lastActivityAt",
      updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found!;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function add(
  opportunityId: string,
  fields: Partial<Record<"channel" | "direction" | "content", string>> = {},
): Promise<AddMessageState> {
  return addMessage(
    null,
    form({
      opportunityId,
      channel: "whatsapp",
      direction: "inbound",
      content: "¿Sigue disponible la Hilux?",
      ...fields,
    }),
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

describe("Server Action: requireTenant() → validación → withTenant() → INSERT → trigger de actividad", () => {
  it("admin (A) registra: una fila con el contacto de la oportunidad, su autor, el reloj de la base y el texto normalizado; la recencia se mueve a ese instante", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    const before = await opportunityRow(id);
    request(USER_A);

    expect(
      await add(id, {
        channel: "email",
        direction: "outbound",
        content: "  Te paso\t\tla cotización.\r\n\r\n\r\nSaludos  ",
      }),
    ).toEqual({ status: "recorded", opportunityId: id });
    // La recencia cambia la cola: se revalidan las dos páginas.
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${id}`,
    ]);

    const [message, ...rest] = await messagesOf(id);
    expect(rest).toEqual([]);
    expect(message).toMatchObject({
      organizationId: ORG_1,
      contactId,
      opportunityId: id,
      channel: "email",
      direction: "outbound",
      content: "Te paso la cotización.\n\nSaludos",
      recordedBy: USER_A,
    });
    const after = await opportunityRow(id);
    // DEC-036 §1: la recencia pasa al reloj del mensaje; etapa, unidad y
    // updated_at no cambian.
    expect(after).toEqual({ ...before, lastActivityAt: message!.createdAt });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(
      before.lastActivityAt.getTime(),
    );
  });

  it("seller (C con ORG_1 activa) registra en la oportunidad de otro; el detalle muestra notas y mensajes en un solo muro, con autores contra quien mira", async () => {
    const { id } = await opportunity(ORG_1);
    request(USER_A);
    expect(
      await addOpportunityNote(
        null,
        form({ opportunityId: id, body: "Primera llamada." }),
      ),
    ).toMatchObject({ status: "recorded" });
    request(USER_C, ORG_1);
    expect(
      await add(id, { direction: "outbound", content: "Le mandé fotos." }),
    ).toMatchObject({ status: "recorded" });

    request(USER_A);
    const forA = await getOpportunityDetail(id);
    expect(
      forA!.activity.map((entry) => [entry.kind, entry.body, entry.author]),
    ).toEqual([
      ["message", "Le mandé fotos.", "Otro miembro"],
      ["note", "Primera llamada.", "Vos"],
    ]);
    expect(forA!.activity[0]).toMatchObject({
      label: "Mensaje enviado",
      channelLabel: "WhatsApp",
    });
    request(USER_C, ORG_1);
    const forC = await getOpportunityDetail(id);
    expect(forC!.activity.map((entry) => entry.author)).toEqual([
      "Vos",
      "Otro miembro",
    ]);
    expect(JSON.stringify(forC)).not.toContain(USER_A);
    expect(JSON.stringify(forC)).not.toContain(USER_C);
  });

  it.each(OPPORTUNITY_STAGES)(
    "se puede registrar en %s (también cerrada) sin cambiar la etapa",
    async (stage) => {
      const { id } = await opportunity(ORG_1, stage);
      request(USER_A);
      expect(await add(id)).toMatchObject({ status: "recorded" });
      expect((await opportunityRow(id)).stage).toBe(stage);
    },
  );

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const { id } = await opportunity(ORG_1);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(add(id))).toBe(path);
    }
    expect(await messagesOf(id)).toEqual([]);
  });

  it("una oportunidad de otra organización es not_found, aun con membership activa en ambas", async () => {
    const foreign = await opportunity(ORG_2);
    const foreign3 = await opportunity(ORG_3);
    const before = await opportunityRow(foreign.id);

    request(USER_A);
    expect(await add(foreign.id)).toEqual({ status: "not_found" });
    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, la de ORG_3 no se ve.
    request(USER_C, ORG_1);
    expect(await add(foreign3.id)).toEqual({ status: "not_found" });
    // Su membership inactiva en ORG_2 no cuenta.
    expect(await add(foreign.id)).toEqual({ status: "not_found" });

    expect(await messagesOf(foreign.id)).toEqual([]);
    expect(await messagesOf(foreign3.id)).toEqual([]);
    expect(await opportunityRow(foreign.id)).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("organización, contacto, autor y fecha del pedido no tienen efecto", async () => {
    const { id, contactId } = await opportunity(ORG_1);
    const otherContact = (await opportunity(ORG_1)).contactId;
    request(USER_A);
    expect(
      await addMessage(
        null,
        form({
          opportunityId: id,
          channel: "manual",
          direction: "inbound",
          content: "Pasó por el showroom.",
          organizationId: ORG_2,
          organization_id: ORG_2,
          contactId: otherContact,
          contact_id: otherContact,
          recordedBy: USER_B,
          recorded_by: USER_B,
          createdAt: "2000-01-01T00:00:00Z",
          created_at: "2000-01-01T00:00:00Z",
        }),
      ),
    ).toMatchObject({ status: "recorded" });
    const [message] = await messagesOf(id);
    expect(message).toMatchObject({
      organizationId: ORG_1,
      contactId,
      recordedBy: USER_A,
    });
    expect(message!.createdAt.getFullYear()).toBeGreaterThan(2020);
  });

  it.each([
    [
      "un canal fuera de la lista",
      { channel: "sms" },
      { channel: "invalid_option" },
    ],
    ["sin dirección", { direction: "" }, { direction: "required" }],
    ["un texto vacío", { content: " \n " }, { content: "empty" }],
    [
      "un texto demasiado largo",
      { content: "a".repeat(MESSAGE_MAX_LENGTH + 1) },
      { content: "too_long" },
    ],
  ] as const)(
    "%s es invalid y no escribe ni mueve la recencia",
    async (_, fields, errors) => {
      const { id } = await opportunity(ORG_1);
      const before = await opportunityRow(id);
      request(USER_A);
      expect(await add(id, fields)).toMatchObject({
        status: "invalid",
        errors,
      });
      expect(await messagesOf(id)).toEqual([]);
      expect(await opportunityRow(id)).toEqual(before);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("el largo máximo exacto se guarda, contado en caracteres como la base", async () => {
    const { id } = await opportunity(ORG_1);
    request(USER_A);
    const content = "🚗".repeat(MESSAGE_MAX_LENGTH);
    expect(await add(id, { content })).toMatchObject({ status: "recorded" });
    expect((await messagesOf(id))[0]!.content).toBe(content);
  });

  it.each([
    ["sin id", { channel: "whatsapp", direction: "inbound", content: "Hola" }],
    [
      "un id que no es UUID",
      {
        opportunityId: "123",
        channel: "whatsapp",
        direction: "inbound",
        content: "Hola",
      },
    ],
    [
      "un id inexistente",
      {
        opportunityId: randomUUID(),
        channel: "whatsapp",
        direction: "inbound",
        content: "Hola",
      },
    ],
  ])("un pedido con %s es not_found", async (_, fields) => {
    request(USER_A);
    expect(await addMessage(null, form(fields))).toEqual({
      status: "not_found",
    });
  });

  it("el filtro de organización del módulo es defensa en profundidad: con el contexto de otro tenant, not_found", async () => {
    const { id } = await opportunity(ORG_1);
    expect(
      await insertOpportunityMessage(tenantContext(USER_B, ORG_2), {
        opportunityId: id,
        message: {
          channel: "whatsapp",
          direction: "inbound",
          content: "Intruso",
        },
      }),
    ).toEqual({ outcome: "not_found" });
    expect(await messagesOf(id)).toEqual([]);
  });
});

/*
 * El fix de recencia del Hito 3 (DEC-035, Consecuencias): una oportunidad
 * sin interacción registrada se enfría, y una nota o un mensaje nuevos la
 * vuelven a Activa en la cola, que además la sube.
 */
describe("la cola refleja la interacción registrada", () => {
  it("una oportunidad Inactiva vuelve a Activa con un mensaje, y sube en la cola", async () => {
    const stale = await opportunity(ORG_3, "qualifying", 6);
    const fresh = await opportunity(ORG_3, "qualifying", 1);
    request(USER_C, ORG_3);

    const before = await getOpportunityQueue(new Date());
    const staleBefore = before.opportunities.find((o) => o.id === stale.id)!;
    expect(staleBefore.lastActivity.state).toBe("stale");
    expect(staleBefore.nba?.code).toBe("recover_stale");
    expect(
      before.opportunities.findIndex((o) => o.id === fresh.id),
    ).toBeLessThan(before.opportunities.findIndex((o) => o.id === stale.id));

    expect(await add(stale.id)).toMatchObject({ status: "recorded" });

    const after = await getOpportunityQueue(new Date());
    const staleAfter = after.opportunities.find((o) => o.id === stale.id)!;
    expect(staleAfter.lastActivity.state).toBe("active");
    expect(staleAfter.nba?.code).not.toBe("recover_stale");
    expect(after.opportunities[0]!.id).toBe(stale.id);
  });

  it("una nota también la vuelve a Activa", async () => {
    const stale = await opportunity(ORG_3, "qualifying", 4);
    request(USER_C, ORG_3);
    const before = await getOpportunityQueue(new Date());
    expect(
      before.opportunities.find((o) => o.id === stale.id)!.lastActivity.state,
    ).toBe("warning");

    expect(
      await addOpportunityNote(
        null,
        form({ opportunityId: stale.id, body: "Lo llamé, vuelve el lunes." }),
      ),
    ).toEqual({ status: "recorded", opportunityId: stale.id });
    // La nota mueve la recencia: también se revalida la cola.
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${stale.id}`,
    ]);

    const after = await getOpportunityQueue(new Date());
    expect(
      after.opportunities.find((o) => o.id === stale.id)!.lastActivity.state,
    ).toBe("active");
  });
});
