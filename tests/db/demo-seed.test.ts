import { readFile } from "node:fs/promises";

import postgres, { type Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getCockpitFeed } from "@/db/queries/cockpit";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getOpportunityPipeline } from "@/db/queries/pipeline";

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
  USER_C,
} from "./support/tenants";

/*
 * Lote de demostración (DEC-058): scripts/demo/seed-demo.sql y
 * scripts/demo/cleanup-demo.sql contra PostgreSQL con las migraciones
 * aplicadas.
 *
 * Corren como `postgres` (la credencial de migración), igual que el SQL
 * Editor de Supabase: el owner, sin superuser, que no saltea CHECKs, FKs ni
 * triggers. Después, los loaders reales (requireTenant() mockeado →
 * withTenant() → RLS) leen la demo: lo que muestran los motores sale de
 * estos datos, sin puntajes escritos.
 *
 * Prueba que el seed elige la organización del admin (y falla si hay más de
 * una posible), que es idempotente, que respeta la máquina de recencia del
 * trigger de actividad (DEC-036), qué calculan los motores sobre él y que la
 * limpieza borra la demo y lo que se le agregó sin tocar lo propio.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 ·
 * C: seller de ORG_1 y admin de ORG_3.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ requireTenant: vi.fn() }));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
  resolveRequestTenant: vi.fn(),
}));

const ADMIN_EMAIL = "Admin.A@porandu.test";

const SEED_PATH = new URL("../../scripts/demo/seed-demo.sql", import.meta.url);
const CLEANUP_PATH = new URL(
  "../../scripts/demo/cleanup-demo.sql",
  import.meta.url,
);

let server: TestServer;
let db: TestDatabase;
let owner: Sql;
let seedScript: string;
let cleanupScript: string;

/** El script con el email del admin en la configuración. */
function withAdminEmail(script: string, email: string): string {
  const configured = script.replace(
    "v_admin_email text := NULL;",
    `v_admin_email text := '${email}';`,
  );
  if (configured === script) throw new Error("config line not found");
  return configured;
}

/** Corre un script entero como `postgres`, como el SQL Editor. */
async function run(script: string): Promise<void> {
  await owner.unsafe(script);
}

/** El id demo de una clave, como lo arma el seed. */
async function demoId(organizationId: string, key: string): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    SELECT md5(${`porandu-demo:v1:${organizationId}:${key}`})::uuid AS id
  `;
  return row!.id;
}

type Counts = Record<string, number>;

const TABLES = [
  "vehicles",
  "contacts",
  "opportunities",
  "opportunity_demand_facts",
  "conversations",
  "messages",
  "message_statuses",
  "opportunity_notes",
  "test_drives",
  "quotes",
] as const;

async function countsOf(organizationId: string): Promise<Counts> {
  const counts: Counts = {};
  for (const table of TABLES) {
    const [row] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ${db.admin(`public.${table}`)}
      WHERE organization_id = ${organizationId}
    `;
    counts[table] = row!.count;
  }
  return counts;
}

const DEMO_COUNTS: Counts = {
  vehicles: 8,
  contacts: 12,
  opportunities: 12,
  opportunity_demand_facts: 55,
  conversations: 5,
  messages: 10,
  message_statuses: 8,
  opportunity_notes: 2,
  test_drives: 6,
  quotes: 5,
};

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await db.admin`
    UPDATE auth.users SET email = ${ADMIN_EMAIL.toLowerCase()}
    WHERE id = ${USER_A}
  `;
  owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
  seedScript = await readFile(SEED_PATH, "utf8");
  cleanupScript = await readFile(CLEANUP_PATH, "utf8");
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await owner?.end();
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenant.mockResolvedValue(tenantContext(USER_A, ORG_1));
});

describe("elegir la organización", () => {
  it("con varias organizaciones posibles y sin configuración, falla sin escribir nada", async () => {
    await expect(run(seedScript)).rejects.toThrow(
      /Hay 3 organizaciones posibles/,
    );
    expect(await countsOf(ORG_1)).toEqual(
      Object.fromEntries(TABLES.map((table) => [table, 0])),
    );
  });

  it("un email sin admin activo falla", async () => {
    await expect(
      run(withAdminEmail(seedScript, "nadie@porandu.test")),
    ).rejects.toThrow(/No encontré un admin activo/);
  });

  it("con un solo admin activo no hace falta configurar nada", async () => {
    // Una base aparte con una sola organización: el caso del fundador.
    const single = await server.createDatabase();
    await runMigrations(single.migrationUrl);
    const user = "00000000-0000-4000-8000-0000000000aa";
    const organization = "00000000-0000-4000-8000-0000000000bb";
    await single.admin`INSERT INTO auth.users (id, email) VALUES (${user}, 'fundador@porandu.test')`;
    await single.admin`INSERT INTO public.profiles (id) VALUES (${user})`;
    await single.admin`INSERT INTO public.organizations (id, name) VALUES (${organization}, 'Concesionaria')`;
    await single.admin`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${organization}, ${user}, 'admin')
    `;
    const singleOwner = postgres(single.migrationUrl, {
      max: 1,
      onnotice: () => {},
    });
    try {
      await singleOwner.unsafe(seedScript);
      const [row] = await single.admin<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.opportunities
        WHERE organization_id = ${organization}
      `;
      expect(row!.count).toBe(12);
      // Sin otro miembro, las notas las firma el admin.
      const notes = await single.admin<{ recorded_by: string }[]>`
        SELECT DISTINCT recorded_by FROM public.opportunity_notes
      `;
      expect(notes.map((note) => note.recorded_by)).toEqual([user]);
      // La limpieza tampoco necesita configuración.
      await singleOwner.unsafe(cleanupScript);
      const [left] = await single.admin<{ count: number }[]>`
        SELECT (SELECT count(*) FROM public.opportunities)
             + (SELECT count(*) FROM public.vehicles)
             + (SELECT count(*) FROM public.contacts)::int AS count
      `;
      expect(Number(left!.count)).toBe(0);
    } finally {
      await singleOwner.end();
      await server.dropDatabase(single);
    }
  });
});

describe("seed", () => {
  beforeAll(async () => {
    await run(withAdminEmail(seedScript, ADMIN_EMAIL));
  });

  it("carga el lote completo solo en la organización del admin", async () => {
    expect(await countsOf(ORG_1)).toEqual(DEMO_COUNTS);
    for (const other of [ORG_2, ORG_3]) {
      expect((await countsOf(other)).opportunities).toBe(0);
    }
  });

  it("es idempotente: otra corrida no inserta ni mueve nada", async () => {
    const before = await db.admin<{ id: string; at: Date }[]>`
      SELECT id, last_activity_at AS at FROM public.opportunities
      WHERE organization_id = ${ORG_1} ORDER BY id
    `;
    await run(withAdminEmail(seedScript, ADMIN_EMAIL));
    expect(await countsOf(ORG_1)).toEqual(DEMO_COUNTS);
    const after = await db.admin<{ id: string; at: Date }[]>`
      SELECT id, last_activity_at AS at FROM public.opportunities
      WHERE organization_id = ${ORG_1} ORDER BY id
    `;
    expect(after).toEqual(before);
  });

  it("los teléfonos no son enviables: sin phone_normalized", async () => {
    const [row] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.contacts
      WHERE organization_id = ${ORG_1} AND phone_normalized IS NOT NULL
    `;
    expect(row!.count).toBe(0);
  });

  it("las notas las firma otro miembro activo (C) y las respuestas, el admin", async () => {
    const notes = await db.admin<{ recorded_by: string }[]>`
      SELECT DISTINCT recorded_by FROM public.opportunity_notes
      WHERE organization_id = ${ORG_1}
    `;
    expect(notes.map((note) => note.recorded_by)).toEqual([USER_C]);
    const replies = await db.admin<{ recorded_by: string }[]>`
      SELECT DISTINCT recorded_by FROM public.messages
      WHERE organization_id = ${ORG_1} AND direction = 'outbound'
    `;
    expect(replies.map((reply) => reply.recorded_by)).toEqual([USER_A]);
  });

  it("la unidad de la ganada está vendida y la del cierre cumple los metadatos", async () => {
    const [won] = await db.admin<
      { status: string; sale_price: string; delivery_status: string }[]
    >`
      SELECT v.status, o.sale_price, o.delivery_status
      FROM public.opportunities o
      JOIN public.vehicles v
        ON v.organization_id = o.organization_id AND v.id = o.vehicle_id
      WHERE o.organization_id = ${ORG_1} AND o.stage = 'won'
    `;
    expect(won).toEqual({
      status: "sold",
      sale_price: "21400.00",
      delivery_status: "scheduled",
    });
  });

  it("los motores calculan los cuatro scores: Intent sin dato, el resto de los datos", async () => {
    const { opportunities } = await getOpportunityQueue();
    expect(opportunities).toHaveLength(12);
    const byName = Object.fromEntries(
      opportunities.map((o) => [o.prospect.name, o]),
    );
    const porandu = Object.fromEntries(
      opportunities.map((o) => [o.prospect.name, o.scores.porandu]),
    );
    expect(porandu).toEqual({
      "María José Benítez": 88,
      "Carlos Giménez": 73,
      "Lucía Ramírez": 60,
      "Jorge Villalba": 73,
      "Ana Paula Ortiz": 33,
      "Diego Fernández": 38,
      "Sofía Martínez": 20,
      "Roberto Acosta": 88,
      "Valeria Duarte": 0,
      "Martín Cáceres": 68,
      "Patricia Insfrán": 100,
      "Fernando Ayala": 63,
    });
    // Intent llega con las conversaciones (DEC-035): nunca se inventa.
    expect(opportunities.every((o) => o.scores.intent === null)).toBe(true);
    // Sin demanda, Vehicle Fit es "sin dato" y no penaliza (DEC-005).
    expect(byName["Sofía Martínez"]!.scores.fit).toBeNull();
    expect(byName["Diego Fernández"]!.scores.fit).toBe(55);
    // Recencia: activa, sin actividad hace días y en riesgo.
    expect(byName["María José Benítez"]!.lastActivity.state).toBe("active");
    expect(byName["Jorge Villalba"]!.lastActivity.state).toBe("warning");
    expect(byName["Ana Paula Ortiz"]!.lastActivity.state).toBe("stale");
  });

  it("Match v0 arma el Top Match y la alternativa reales del detalle", async () => {
    const expectations: Array<
      [key: string, top: string, alternative: string | null]
    > = [
      ["o01", "Toyota Hilux", "Toyota Hilux"],
      ["o03", "Hyundai Tucson", "Hyundai Creta"],
      ["o05", "Toyota Hilux", "Toyota Hilux"],
      ["o10", "Toyota Corolla Cross", "Toyota Hilux"],
      ["o02", "Toyota Corolla Cross", null],
    ];
    for (const [key, top, alternative] of expectations) {
      const detail = await getOpportunityDetail(
        await demoId(ORG_1, `opportunity:${key}`),
      );
      expect(detail?.matches.kind, key).toBe("matches");
      if (detail?.matches.kind !== "matches") continue;
      expect(detail.matches.top.name, key).toBe(top);
      expect(detail.matches.alternative?.name ?? null, key).toBe(alternative);
    }
    const o07 = await getOpportunityDetail(
      await demoId(ORG_1, "opportunity:o07"),
    );
    expect(o07?.matches).toEqual({ kind: "empty", reason: "no_demand" });
  });

  it("el embudo reparte las doce oportunidades en las cinco etapas", async () => {
    const board = await getOpportunityPipeline();
    expect(
      Object.fromEntries(board.columns.map((c) => [c.stage, c.total])),
    ).toEqual({ new: 3, qualifying: 4, negotiating: 3, won: 1, lost: 1 });
  });

  it("el Cockpit del admin queda activo: chats sin leer, pruebas, cotizaciones y notas del equipo", async () => {
    const feed = await getCockpitFeed();
    const summary = Object.fromEntries(
      feed.summary.map((tile) => [tile.key, tile.value]),
    );
    expect(summary).toEqual({ unread: 3, upcoming: 2, overdue: 1, quotes: 5 });
    const kinds = feed.recent
      .flatMap((group) => group.events)
      .map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "note")).toHaveLength(2);
  });
});

describe("cleanup", () => {
  it("se niega si una oportunidad propia usa una unidad demo", async () => {
    const contact = "00000000-0000-4000-8000-0000000000c1";
    const own = "00000000-0000-4000-8000-0000000000f1";
    await db.admin`
      INSERT INTO public.contacts (id, organization_id, name)
      VALUES (${contact}, ${ORG_1}, 'Cliente propio')
    `;
    await db.admin`
      INSERT INTO public.opportunities
        (id, organization_id, contact_id, stage, source, vehicle_id)
      VALUES (${own}, ${ORG_1}, ${contact}, 'negotiating', 'showroom',
              ${await demoId(ORG_1, "vehicle:creta")})
    `;
    await expect(
      run(withAdminEmail(cleanupScript, ADMIN_EMAIL)),
    ).rejects.toThrow(/oportunidad propia usa una unidad/);
    expect(await countsOf(ORG_1)).toMatchObject({ opportunities: 13 });

    await db.admin`DELETE FROM public.opportunities WHERE id = ${own}`;
    await db.admin`DELETE FROM public.contacts WHERE id = ${contact}`;
  });

  it("borra la demo y lo que se le agregó desde la app, sin tocar lo propio", async () => {
    const own = "00000000-0000-4000-8000-0000000000a1";
    await db.admin`
      INSERT INTO public.vehicles (id, organization_id, brand, model, year, status)
      VALUES (${own}, ${ORG_1}, 'Fiat', 'Strada', 2024, 'in_preparation')
    `;
    // Trabajo hecho sobre la demo, como desde la app.
    await db.admin`
      INSERT INTO public.opportunity_notes
        (organization_id, opportunity_id, body, recorded_by)
      VALUES (${ORG_1}, ${await demoId(ORG_1, "opportunity:o03")},
              'La llamé y vuelve el sábado.', ${USER_A})
    `;
    await db.admin`
      INSERT INTO public.conversation_reads
        (organization_id, conversation_id, user_id, read_up_to)
      VALUES (${ORG_1}, ${await demoId(ORG_1, "conversation:o05")},
              ${USER_A}, now())
    `;

    await run(withAdminEmail(cleanupScript, ADMIN_EMAIL));

    expect(await countsOf(ORG_1)).toEqual({
      ...Object.fromEntries(TABLES.map((table) => [table, 0])),
      vehicles: 1,
    });
    const [reads] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.conversation_reads
      WHERE organization_id = ${ORG_1}
    `;
    expect(reads!.count).toBe(0);
  });

  it("después de limpiar, el seed vuelve a cargar el lote", async () => {
    await run(withAdminEmail(seedScript, ADMIN_EMAIL));
    expect(await countsOf(ORG_1)).toEqual({ ...DEMO_COUNTS, vehicles: 9 });
  });
});
