import { randomBytes, randomUUID } from "node:crypto";

import {
  combineChunks,
  createChunks,
  stringFromBase64URL,
  stringToBase64URL,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getTeam } from "@/db/queries/settings";
import { memberships, organizations, profiles } from "@/db/schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "@/db/tenant";
import type { TeamView } from "@/domains/team/members";
import { signIn, signOut } from "@/lib/auth/actions";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { inviteMember, removeMember } from "@/lib/settings/actions";
import { selectOrganization } from "@/lib/tenant/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { resolveTenant } from "@/lib/tenant/resolution";
import { getActiveMemberships, requireTenant } from "@/lib/tenant/session";

import {
  cleanupSynthetic,
  listSyntheticUsers,
  syntheticEmail,
  syntheticOrganizationName,
  syntheticUserAdmin,
  type SyntheticUserAdmin,
} from "../../../scripts/staging/synthetic.mts";
import { probeDataApi } from "../../../scripts/staging/verify.mts";
import { closeRuntimePool } from "../../db/support/runtime";
import { Browser } from "./browser";
import { RedirectSignal, setCurrentBrowser } from "./request-context";
import type { AuthTenantTarget } from "./target";

/*
 * Acceptance funcional de H0.6 + H0.7 contra un Supabase real:
 *
 *   Supabase Auth (email + password) → getClaims() → memberships activas →
 *   requireTenant() → withTenant() → RLS
 *
 * y, desde el Hito 6 (DEC-038), el equipo: la lista (getTeam() →
 * private.organization_members()) y la invitación por email (inviteMember()
 * → private.find_member_candidate()) leen auth.users.email como postgres
 * (SECURITY DEFINER), con usuarios creados por la Auth Admin API.
 *
 * con el código de la aplicación sin cambios: las Server Actions signIn,
 * selectOrganization y signOut, requireTenant() y withTenant() por
 * RUNTIME_DATABASE_URL (app_runtime). Solo se simulan cookies() y
 * redirect() de Next (el navegador de ./browser.ts guarda las cookies).
 *
 * Datos sintéticos de la corrida (scripts/staging/synthetic.mts):
 *   a: admin de A · b: seller de B · ab: seller de A y admin de B ·
 *   d: seller INACTIVO de A · e: sin memberships · C: organización sin
 *   miembros.
 * Usuarios por la Admin API (sin signup público); profiles, organizaciones y
 * memberships con la credencial de migración. Se borran al final; el
 * schema, las migraciones y app_runtime no se tocan.
 *
 * El test file mockea server-only, next/headers y next/navigation con
 * ./request-context.ts, y next/cache (revalidatePath() de las Server
 * Actions de equipo) con un no-op.
 */

const USER_KEYS = ["a", "b", "ab", "d", "e"] as const;
type UserKey = (typeof USER_KEYS)[number];
const ORG_KEYS = ["A", "B", "C"] as const;
type OrgKey = (typeof ORG_KEYS)[number];

const MEMBERSHIPS: [UserKey, OrgKey, "admin" | "seller", boolean][] = [
  ["a", "A", "admin", true],
  ["b", "B", "seller", true],
  ["ab", "A", "seller", true],
  ["ab", "B", "admin", true],
  ["d", "A", "seller", false],
];

type SyntheticUser = { id: string; email: string; password: string };

type Outcome = { redirect: string | null; value: unknown };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function describeAuthTenantAcceptance(
  target: () => AuthTenantTarget | Promise<AuthTenantTarget>,
): void {
  describe("Supabase Auth → getClaims() → memberships → requireTenant() → withTenant() → RLS", () => {
    let t: AuthTenantTarget;
    let fixtures: Sql;
    /** STAGING_SECRET_KEY: solo crear y eliminar usuarios (DEC-022). */
    let admin: SyntheticUserAdmin;
    const users = {} as Record<UserKey, SyntheticUser>;
    const orgs = {} as Record<OrgKey, string>;

    /** Una request del navegador: cookies() y redirect() de Next. */
    async function request(
      browser: Browser,
      fn: () => Promise<unknown>,
    ): Promise<Outcome> {
      browser.request();
      setCurrentBrowser(browser);
      try {
        return { redirect: null, value: await fn() };
      } catch (error) {
        if (error instanceof RedirectSignal) {
          return { redirect: error.path, value: undefined };
        }
        throw error;
      } finally {
        setCurrentBrowser(null);
        browser.respond();
      }
    }

    async function login(key: UserKey): Promise<Browser> {
      const browser = new Browser();
      const { email, password } = users[key];
      const outcome = await request(browser, () =>
        signIn(null, form({ email, password })),
      );
      expect(outcome.redirect).toBe("/cockpit");
      expect(browser.names().some((name) => AUTH_COOKIE.test(name))).toBe(true);
      return browser;
    }

    async function tenant(browser: Browser): Promise<TenantContext | string> {
      const outcome = await request(browser, () => requireTenant());
      return outcome.redirect ?? (outcome.value as TenantContext);
    }

    async function resolved(browser: Browser): Promise<TenantContext> {
      const ctx = await tenant(browser);
      if (typeof ctx === "string") throw new Error(`redirected to ${ctx}`);
      return ctx;
    }

    /** Lo que RLS deja ver con un contexto. */
    function visible(ctx: TenantContext) {
      return withTenant(ctx, async (tx: ScopedTransaction) => ({
        organizations: (
          await tx.select({ id: organizations.id }).from(organizations)
        )
          .map((row) => row.id)
          .sort(),
        memberships: (
          await tx
            .select({ organizationId: memberships.organizationId })
            .from(memberships)
        ).map((row) => row.organizationId),
        profiles: (await tx.select({ id: profiles.id }).from(profiles)).map(
          (row) => row.id,
        ),
      }));
    }

    /** Sesión de Supabase guardada en las cookies (@supabase/ssr). */
    async function readSession(browser: Browser) {
      const chunks = browser.names().filter((name) => AUTH_COOKIE.test(name));
      const key = chunks[0]?.replace(/\.\d+$/, "") ?? "";
      const raw = await combineChunks(key, (name) => browser.get(name));
      if (!raw?.startsWith("base64-")) throw new Error("no session cookie");
      return {
        key,
        chunks,
        session: JSON.parse(stringFromBase64URL(raw.slice(7))) as {
          access_token: string;
        } & Record<string, unknown>,
      };
    }

    beforeAll(async () => {
      t = await target();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", t.supabaseUrl);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", t.publishableKey);
      vi.stubEnv("RUNTIME_DATABASE_URL", t.runtimeUrl);
      fixtures = postgres(t.migrationUrl, {
        max: 1,
        prepare: false,
        onnotice: () => {},
      });
      admin = syntheticUserAdmin(t.supabaseUrl, t.secretKey);

      // Usuarios reales de Supabase Auth, solo por la Auth Admin API.
      for (const key of USER_KEYS) {
        const password = randomBytes(24).toString("base64url");
        const { id, email } = await admin.createUser({
          runId: t.runId,
          key,
          password,
        });
        users[key] = { id, email, password };
      }

      // Profiles, organizaciones y memberships con la credencial de migración.
      await fixtures.begin(async (tx) => {
        for (const key of USER_KEYS) {
          await tx`
            INSERT INTO public.profiles (id, full_name)
            VALUES (${users[key].id}, ${`SYNTHETIC ${key} ${t.runId}`})
          `;
        }
        for (const key of ORG_KEYS) {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO public.organizations (name)
            VALUES (${syntheticOrganizationName(t.runId, key)})
            RETURNING id
          `;
          if (!row) throw new Error("organization without id");
          orgs[key] = row.id;
        }
        for (const [user, org, role, active] of MEMBERSHIPS) {
          await tx`
            INSERT INTO public.memberships (organization_id, user_id, role, active)
            VALUES (${orgs[org]}, ${users[user].id}, ${role}, ${active})
          `;
        }
      });
    });

    afterAll(async () => {
      try {
        // Idempotente: el último test ya limpió si llegó a correr.
        if (fixtures && admin) {
          await cleanupSynthetic(fixtures, admin, t.runId);
        }
      } finally {
        await fixtures?.end({ timeout: 5 });
        await closeRuntimePool();
        vi.unstubAllEnvs();
      }
    });

    it("el signup público está cerrado: los usuarios solo se crean por la Admin API", async () => {
      const anon = createClient(t.supabaseUrl, t.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anon.auth.signUp({
        email: syntheticEmail(t.runId, "signup"),
        password: randomBytes(24).toString("base64url"),
      });
      if (data.user) await admin.deleteUser(data.user.id);
      expect(error).not.toBeNull();
      expect(data.user).toBeNull();
    });

    it("login real (signIn) y claims verificados con getClaims()", async () => {
      const browser = await login("a");
      const outcome = await request(browser, () => getAuthenticatedUser());
      const user = outcome.value as Awaited<
        ReturnType<typeof getAuthenticatedUser>
      >;
      expect(user?.userId).toBe(users.a.id);
      expect(user?.claims).toMatchObject({
        sub: users.a.id,
        role: "authenticated",
      });
      // Una organización nunca sale de los claims (DEC-020).
      expect(Object.keys(user?.claims ?? {}).sort()).toEqual([
        "aal",
        "aud",
        "exp",
        "iat",
        "iss",
        "role",
        "session_id",
        "sub",
      ]);
    });

    it("A solo ve su organización y B solo la suya (RLS + filtro explícito)", async () => {
      const ctxA = await resolved(await login("a"));
      expect([ctxA.organizationId, ctxA.role]).toEqual([orgs.A, "admin"]);
      const seenA = await visible(ctxA);
      expect(seenA.organizations).toEqual([orgs.A]);
      expect(new Set(seenA.memberships)).toEqual(new Set([orgs.A]));
      // Memberships de A: a, ab y la inactiva de d. Nada de B.
      expect(seenA.memberships).toHaveLength(3);
      expect(seenA.profiles).toEqual([users.a.id]);
      expect(
        await withTenant(ctxA, (tx) =>
          tx.select().from(organizations).where(eq(organizations.id, orgs.B)),
        ),
      ).toEqual([]);

      const ctxB = await resolved(await login("b"));
      expect([ctxB.organizationId, ctxB.role]).toEqual([orgs.B, "seller"]);
      const seenB = await visible(ctxB);
      expect(seenB.organizations).toEqual([orgs.B]);
      expect(new Set(seenB.memberships)).toEqual(new Set([orgs.B]));
      expect(seenB.profiles).toEqual([users.b.id]);
      expect(
        await withTenant(ctxB, (tx) =>
          tx.select().from(organizations).where(eq(organizations.id, orgs.A)),
        ),
      ).toEqual([]);
    });

    it("varias memberships: selector, cookie validada y rol de la membership", async () => {
      const browser = await login("ab");
      expect(await tenant(browser)).toBe("/select-organization");

      const listed = await request(browser, () => getActiveMemberships());
      expect(
        (listed.value as { organizationId: string }[])
          .map((m) => m.organizationId)
          .sort(),
      ).toEqual([orgs.A, orgs.B].sort());

      const selectB = await request(browser, () =>
        selectOrganization(
          null,
          form({ organizationId: orgs.B, role: "admin" }),
        ),
      );
      expect(selectB.redirect).toBe("/cockpit");
      expect(browser.get(ACTIVE_ORGANIZATION_COOKIE)).toBe(orgs.B);
      const ctxB = await resolved(browser);
      expect([ctxB.organizationId, ctxB.role]).toEqual([orgs.B, "admin"]);

      // Organización sin membership: error genérico y la cookie no cambia.
      const selectC = await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.C })),
      );
      expect(selectC).toEqual({
        redirect: null,
        value: { error: "invalid_selection" },
      });
      expect(browser.get(ACTIVE_ORGANIZATION_COOKIE)).toBe(orgs.B);

      // Cookie falsificada: nunca concede acceso.
      for (const forged of [orgs.C, randomUUID(), "no-es-un-uuid"]) {
        browser.set(ACTIVE_ORGANIZATION_COOKIE, forged);
        expect(await tenant(browser)).toBe("/select-organization");
      }

      await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.A })),
      );
      const ctxA = await resolved(browser);
      expect([ctxA.organizationId, ctxA.role]).toEqual([orgs.A, "seller"]);
      expect((await visible(ctxA)).organizations).toEqual(
        [orgs.A, orgs.B].sort(),
      );
    });

    it("membership inactiva: /no-access, y RLS no expone la organización a un contexto forzado", async () => {
      const browser = await login("d");
      expect(await tenant(browser)).toBe("/no-access");

      const user = await request(browser, () => getAuthenticatedUser());
      const authenticated = user.value as NonNullable<
        Awaited<ReturnType<typeof getAuthenticatedUser>>
      >;
      const forced = resolveTenant(
        authenticated,
        [{ organizationId: orgs.A, organizationName: "A", role: "seller" }],
        undefined,
      );
      if (forced.kind !== "resolved") throw new Error("unresolved");
      expect(await visible(forced.context)).toEqual({
        organizations: [],
        memberships: [],
        profiles: [users.d.id],
      });
    });

    it("sin memberships: /no-access", async () => {
      expect(await tenant(await login("e"))).toBe("/no-access");
    });

    /** El equipo de la organización activa del navegador (getTeam()). */
    async function team(browser: Browser): Promise<TeamView> {
      const outcome = await request(browser, () => getTeam());
      if (outcome.redirect)
        throw new Error(`redirected to ${outcome.redirect}`);
      return outcome.value as TeamView;
    }

    /** Lo que la UI usa de cada miembro, sin ids de membership ni fechas. */
    function members(view: TeamView) {
      return view.members.map(
        ({ userId, email, fullName, role, isViewer, manageable }) => ({
          userId,
          email,
          fullName,
          role,
          isViewer,
          manageable,
        }),
      );
    }

    function member(
      key: UserKey,
      role: "admin" | "seller",
      viewer: UserKey,
      viewerIsAdmin: boolean,
    ) {
      return {
        userId: users[key].id,
        // El email de auth.users, el que guardó la Auth Admin API.
        email: users[key].email,
        fullName: `SYNTHETIC ${key} ${t.runId}`,
        role,
        isViewer: key === viewer,
        manageable: viewerIsAdmin && key !== viewer,
      };
    }

    it("equipo (DEC-038 §6): getTeam() lista nombre, email de auth.users y rol con private.organization_members()", async () => {
      // a, admin de A: los miembros activos de A (la inactiva de d no).
      const asAdmin = await team(await login("a"));
      expect(asAdmin).toMatchObject({
        viewerRole: "admin",
        canInvite: true,
        adminCount: 1,
      });
      expect(members(asAdmin)).toEqual([
        member("a", "admin", "a", true),
        member("ab", "seller", "a", true),
      ]);

      // ab con A activa: la misma lista, de solo lectura (seller).
      const browser = await login("ab");
      await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.A })),
      );
      const asSeller = await team(browser);
      expect(asSeller).toMatchObject({
        viewerRole: "seller",
        canInvite: false,
      });
      expect(members(asSeller)).toEqual([
        member("a", "admin", "ab", false),
        member("ab", "seller", "ab", false),
      ]);

      // ab con B activa: solo los miembros de B, nunca los de A.
      await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.B })),
      );
      const asAdminOfB = await team(browser);
      expect(asAdminOfB.viewerRole).toBe("admin");
      expect(members(asAdminOfB)).toEqual([
        member("ab", "admin", "ab", true),
        member("b", "seller", "ab", true),
      ]);

      // El email llega por la función: authenticated sigue sin leer
      // auth.users ni los perfiles ajenos. La prueba no pide columnas: si
      // alguna vez pasara, el fallo no imprime emails de staging.
      const ctx = await resolved(browser);
      await expect(
        withTenant(ctx, (tx) =>
          tx.execute(sql`SELECT 1 FROM auth.users LIMIT 0`),
        ),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
      expect((await visible(ctx)).profiles).toEqual([users.ab.id]);
    });

    it("invitar por email (DEC-038 §3): private.find_member_candidate() lee auth.users.email; un seller no puede", async () => {
      // Seller (ab con A activa): la acción lo corta y la base también.
      const sellerBrowser = await login("ab");
      await request(sellerBrowser, () =>
        selectOrganization(null, form({ organizationId: orgs.A })),
      );
      const asSeller = await request(sellerBrowser, () =>
        inviteMember(null, form({ email: users.d.email, role: "admin" })),
      );
      expect(asSeller.value).toEqual({ status: "forbidden" });
      const sellerCtx = await resolved(sellerBrowser);
      await expect(
        withTenant(sellerCtx, (tx) =>
          tx.execute(
            sql`SELECT private.find_member_candidate(${orgs.A}, ${users.d.email})`,
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: "42501" } });

      // Admin (a): un email sin cuenta no cambia nada.
      const adminBrowser = await login("a");
      const nobody = syntheticEmail(t.runId, "nobody");
      const missing = await request(adminBrowser, () =>
        inviteMember(null, form({ email: nobody, role: "seller" })),
      );
      expect(missing.value).toEqual({
        status: "no_account",
        values: { email: nobody, role: "seller" },
      });

      // La cuenta de d (membership revocada en A) se encuentra por su email,
      // sin distinguir mayúsculas, y vuelve activa.
      const invited = await request(adminBrowser, () =>
        inviteMember(
          null,
          form({ email: users.d.email.toUpperCase(), role: "seller" }),
        ),
      );
      expect(invited.value).toEqual({
        status: "reactivated",
        invitation: { email: users.d.email, role: "seller" },
      });
      const withD = await team(adminBrowser);
      expect(members(withD)).toEqual([
        member("a", "admin", "a", true),
        member("ab", "seller", "a", true),
        member("d", "seller", "a", true),
      ]);
      const reactivated = await resolved(await login("d"));
      expect([reactivated.organizationId, reactivated.role]).toEqual([
        orgs.A,
        "seller",
      ]);

      // Revocar de nuevo (deja d como estaba) y la guarda de la membership
      // propia, con claims reales.
      const dMembership = withD.members.find((m) => m.userId === users.d.id);
      const aMembership = withD.members.find((m) => m.userId === users.a.id);
      if (!dMembership || !aMembership) throw new Error("missing member");
      const removed = await request(adminBrowser, () =>
        removeMember(null, form({ membershipId: dMembership.membershipId })),
      );
      expect(removed.value).toEqual({ status: "removed" });
      expect(await tenant(await login("d"))).toBe("/no-access");
      const self = await request(adminBrowser, () =>
        removeMember(null, form({ membershipId: aMembership.membershipId })),
      );
      expect(self.value).toEqual({ status: "self" });
    });

    it("revocación: rige desde el request siguiente, aunque la cookie siga ahí", async () => {
      const browser = await login("ab");
      await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.B })),
      );
      const before = await resolved(browser);
      expect(before.organizationId).toBe(orgs.B);

      await fixtures`
        UPDATE public.memberships SET active = false
        WHERE user_id = ${users.ab.id} AND organization_id = ${orgs.B}
      `;

      // Una sola membership activa: A, aunque la cookie diga B.
      const after = await resolved(browser);
      expect([after.organizationId, after.role]).toEqual([orgs.A, "seller"]);
      // El contexto emitido antes ya no ve B.
      expect(
        await withTenant(before, (tx) =>
          tx.select().from(organizations).where(eq(organizations.id, orgs.B)),
        ),
      ).toEqual([]);
    });

    it("un access token alterado no autentica (getClaims() verifica la firma)", async () => {
      const browser = await login("a");

      /** Reescribe la cookie de sesión con el access token dado. */
      async function writeAccessToken(token: string): Promise<void> {
        const { key, chunks, session } = await readSession(browser);
        session.access_token = token;
        for (const name of chunks) browser.delete(name);
        for (const chunk of createChunks(
          key,
          `base64-${stringToBase64URL(JSON.stringify(session))}`,
        )) {
          browser.set(chunk.name, chunk.value);
        }
      }

      const { session } = await readSession(browser);
      // Control: la misma sesión reescrita sin cambios sigue autenticando.
      await writeAccessToken(session.access_token);
      expect((await resolved(browser)).userId).toBe(users.a.id);

      // Mismo token con `sub` de otro usuario y la firma original.
      const [header = "", payload = "", signature = ""] =
        session.access_token.split(".");
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString(),
      ) as Record<string, unknown>;
      claims.sub = users.b.id;
      await writeAccessToken(
        [
          header,
          Buffer.from(JSON.stringify(claims)).toString("base64url"),
          signature,
        ].join("."),
      );
      expect(await tenant(browser)).toBe("/login");
    });

    it("la Data API no es una ruta lateral con el token de un usuario", async (context) => {
      if (!t.probeDataApi) context.skip();
      const { session } = await readSession(await login("a"));
      for (const result of await probeDataApi(
        t.supabaseUrl,
        t.publishableKey,
        session.access_token,
      )) {
        expect(result, result.detail).toMatchObject({ ok: true });
      }
    });

    it("logout: cierra la sesión y borra la organización activa", async () => {
      const browser = await login("ab");
      await request(browser, () =>
        selectOrganization(null, form({ organizationId: orgs.A })),
      );
      expect(browser.get(ACTIVE_ORGANIZATION_COOKIE)).toBe(orgs.A);

      const outcome = await request(browser, () => signOut());
      expect(outcome.redirect).toBe("/login");
      expect(browser.names()).toEqual([]);
      expect(await tenant(browser)).toBe("/login");
    });

    it("limpieza: borra usuarios, profiles, organizaciones y memberships sintéticos", async () => {
      const report = await cleanupSynthetic(fixtures, admin, t.runId);
      expect(report).toEqual({
        users: USER_KEYS.length,
        profiles: USER_KEYS.length,
        memberships: MEMBERSHIPS.length,
        organizations: ORG_KEYS.length,
      });
      expect(await listSyntheticUsers(fixtures, t.runId)).toEqual([]);
      const [left] = await fixtures<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.organizations
        WHERE starts_with(name, ${syntheticOrganizationName(t.runId, "")})
      `;
      expect(left?.count).toBe(0);
    });
  });
}
