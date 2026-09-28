import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { VerifiedClaims } from "../src/claims";
import { verifiedClaimsFor } from "./support/claims";
import { asUser, openSql } from "./support/db";
import { env, isE1 } from "./support/env";

/*
 * C8 · el navegador no tiene una Data API lateral hacia las tablas de la app.
 * Se llama a PostgREST y GraphQL exactamente como lo haría un navegador:
 * publishable key (apikey) y, opcionalmente, el access token del usuario.
 *
 * Control positivo: `spike_exposed.tenant_probe_exposed` tiene las mismas
 * grants y RLS pero SÍ está expuesto. Si el control devuelve datos y las
 * tablas de `public` no, la diferencia es la exposición del schema.
 */

const fixtures = inject("fixtures");
const APP_TABLES = ["organizations", "profiles", "memberships", "tenant_probe"];
const observations: Record<string, unknown>[] = [];

type Principal = { readonly name: string; readonly token: string | undefined };

async function call(
  path: string,
  principal: Principal,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: unknown }> {
  if (!env.supabaseUrl || !env.publishableKey) throw new Error("solo e1");
  const response = await fetch(`${env.supabaseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: env.publishableKey,
      ...(principal.token
        ? { Authorization: `Bearer ${principal.token}` }
        : {}),
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // cuerpo no JSON
  }
  observations.push({
    path,
    principal: principal.name,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    status: response.status,
    body,
  });
  return { status: response.status, body };
}

/** Nombres que pg_graphql daría a las tablas de la app (sin inflexión). */
const APP_COLLECTIONS = [
  "organizationsCollection",
  "profilesCollection",
  "membershipsCollection",
  "tenant_probeCollection",
];

/**
 * Consulta una colección de pg_graphql. `rows` es null si la colección no
 * existe para ese rol (o GraphQL no responde datos); si existe, sus filas.
 */
async function queryCollection(
  principal: Principal,
  collection: string,
  field = "__typename",
): Promise<{ rows: unknown[] | null; errors: string[] }> {
  const result = await call("/graphql/v1", principal, {
    method: "POST",
    body: { query: `{ ${collection} { edges { node { ${field} } } } }` },
  });
  const body = result.body as {
    data?: Record<string, { edges?: { node: unknown }[] } | null> | null;
    errors?: { message: string }[];
  };
  const edges = body?.data?.[collection]?.edges;
  return {
    rows: edges ? edges.map((edge) => edge.node) : null,
    errors: (body?.errors ?? []).map((error) => error.message),
  };
}

function expectNoData(result: { status: number; body: unknown }): void {
  const leaked =
    result.status < 300 && Array.isArray(result.body) && result.body.length > 0;
  expect(leaked, JSON.stringify(result)).toBe(false);
  expect(result.status, JSON.stringify(result)).toBeGreaterThanOrEqual(400);
}

describe.runIf(isE1)(
  "C8 · Data API lateral (PostgREST + GraphQL locales)",
  () => {
    const principals: Principal[] = [
      { name: "anon", token: undefined },
      { name: "uA", token: fixtures.users.uA.accessToken },
    ];
    const migration = openSql(env.migrationUrl, "data-api-check", 1);

    beforeAll(async () => {
      // Espera a que PostgREST recargue el schema cache con el control expuesto.
      const deadline = Date.now() + 45_000;
      for (;;) {
        const probe = await call(
          "/rest/v1/tenant_probe_exposed?select=id",
          principals[1] as Principal,
          {
            headers: { "Accept-Profile": "spike_exposed" },
          },
        );
        if (probe.status === 200) break;
        if (Date.now() > deadline)
          throw new Error(`control no disponible: ${JSON.stringify(probe)}`);
        await migration`select pg_notify('pgrst', 'reload schema')`;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      observations.length = 0;
    });

    afterAll(async () => {
      await migration.end({ timeout: 5 });
      await mkdir(env.resultsDir, { recursive: true });
      await writeFile(
        join(env.resultsDir, "data-api.json"),
        `${JSON.stringify(observations, null, 2)}\n`,
      );
    });

    it("control positivo: el schema expuesto SÍ sirve datos, filtrados por RLS", async () => {
      const asA = await call(
        "/rest/v1/tenant_probe_exposed?select=organization_id",
        { name: "uA", token: fixtures.users.uA.accessToken },
        {
          headers: { "Accept-Profile": "spike_exposed" },
        },
      );
      expect(asA.status).toBe(200);
      expect(asA.body).toEqual([{ organization_id: fixtures.orgs.A }]);
      const asB = await call(
        "/rest/v1/tenant_probe_exposed?select=organization_id",
        { name: "uB", token: fixtures.users.uB.accessToken },
        {
          headers: { "Accept-Profile": "spike_exposed" },
        },
      );
      expect(asB.body).toEqual([{ organization_id: fixtures.orgs.B }]);
    });

    describe.each(principals)("$name", (principal) => {
      it.each(APP_TABLES)(
        "GET %s (schema por defecto y Accept-Profile: public) → sin datos",
        async (table) => {
          expectNoData(await call(`/rest/v1/${table}?select=*`, principal));
          expectNoData(
            await call(`/rest/v1/${table}?select=*`, principal, {
              headers: { "Accept-Profile": "public" },
            }),
          );
        },
      );

      it("POST tenant_probe con Content-Profile: public → rechazado y nada se escribe", async () => {
        const [before] = await migration<
          { n: number }[]
        >`select count(*)::int as n from public.tenant_probe`;
        const result = await call("/rest/v1/tenant_probe", principal, {
          method: "POST",
          headers: {
            "Content-Profile": "public",
            Prefer: "return=representation",
          },
          body: { organization_id: fixtures.orgs.B, label: "via-data-api" },
        });
        expect(result.status).toBeGreaterThanOrEqual(400);
        const [after] = await migration<
          { n: number }[]
        >`select count(*)::int as n from public.tenant_probe`;
        expect(after?.n).toBe(before?.n);
      });

      it("RPC private.user_org_ids → no expuesta", async () => {
        expectNoData(
          await call("/rest/v1/rpc/user_org_ids", principal, {
            method: "POST",
            body: {},
          }),
        );
        expectNoData(
          await call("/rest/v1/rpc/user_org_ids", principal, {
            method: "POST",
            headers: { "Content-Profile": "private" },
            body: {},
          }),
        );
      });

      it("GraphQL con pg_graphql deshabilitado (default local): ninguna colección de la app devuelve datos", async () => {
        for (const collection of APP_COLLECTIONS) {
          const result = await queryCollection(principal, collection);
          expect(result.rows, JSON.stringify(result)).toBeNull();
        }
      });
    });

    // Con la extensión deshabilitada el chequeo anterior es trivial. Acá se
    // habilita pg_graphql y se repite, con control positivo: la colección del
    // schema expuesto debe aparecer para uA (prueba que la reflexión funciona).
    describe("GraphQL con pg_graphql habilitado", () => {
      const userA: Principal = {
        name: "uA",
        token: fixtures.users.uA.accessToken,
      };

      beforeAll(async () => {
        await migration`create extension if not exists pg_graphql`;
        await migration`select pg_notify('pgrst', 'reload schema')`;
        const deadline = Date.now() + 45_000;
        for (;;) {
          const probe = await call("/graphql/v1", userA, {
            method: "POST",
            body: { query: "{ __typename }" },
          });
          if (!JSON.stringify(probe.body).includes("not enabled")) break;
          if (Date.now() > deadline) {
            throw new Error(
              `pg_graphql no quedó activo: ${JSON.stringify(probe)}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      });

      // pg_graphql de esta imagen no ofrece introspección ("Unknown field
      // __schema"): se consulta cada colección directamente, a nivel de datos.
      it("control positivo: uA lee la colección del schema expuesto, filtrada por RLS", async () => {
        const result = await queryCollection(
          userA,
          "tenant_probe_exposedCollection",
          "organization_id",
        );
        expect(result.rows, JSON.stringify(result)).toEqual([
          { organization_id: fixtures.orgs.A },
        ]);
      });

      it.each(principals)(
        "$name: ninguna colección de las tablas de public devuelve datos",
        async (principal) => {
          for (const collection of APP_COLLECTIONS) {
            const result = await queryCollection(principal, collection);
            expect(result.rows, JSON.stringify(result)).toBeNull();
          }
        },
      );

      // Mecanismo, a nivel SQL y en la MISMA corrida: graphql.resolve() como uA
      // (app_runtime + SET LOCAL ROLE authenticated + claims) con el search_path
      // que arma PostgREST en cada variante de extra_search_path.
      describe("mecanismo: pg_graphql refleja los schemas del search_path", () => {
        const runtimeSql = openSql(env.runtimeUrl, "graphql-mechanism", 1);
        let claimsA: VerifiedClaims;
        beforeAll(async () => {
          claimsA = await verifiedClaimsFor(fixtures.users.uA);
        });
        afterAll(() => runtimeSql.end({ timeout: 5 }));

        async function resolveAs(searchPath: string, query: string) {
          const response = await asUser(runtimeSql, claimsA, async (tx) => {
            await tx.unsafe(`set local search_path = ${searchPath}`);
            const [row] = await tx<
              { r: unknown }[]
            >`select graphql.resolve(${query}) as r`;
            return row?.r;
          });
          observations.push({
            path: "graphql.resolve (SQL)",
            principal: "uA",
            method: "SQL",
            headers: { search_path: searchPath },
            status: 0,
            body: response,
          });
          return response as {
            data?: Record<
              string,
              { edges: { node: { id?: string } }[] }
            > | null;
            errors?: { message: string }[];
          };
        }

        it("reproducción del hallazgo: con `public` en el search_path (default de Supabase) authenticated lee tablas de public; RLS contiene el cruce", async () => {
          const orgsResult = await resolveAs(
            "graphql_public, public, extensions",
            "{ organizationsCollection { edges { node { id } } } }",
          );
          expect(
            orgsResult.data?.organizationsCollection?.edges.map(
              (e) => e.node.id,
            ),
            JSON.stringify(orgsResult),
          ).toEqual([fixtures.orgs.A]);
          const probeResult = await resolveAs(
            "graphql_public, public, extensions",
            "{ tenant_probeCollection { edges { node { id } } } }",
          );
          const ids = probeResult.data?.tenant_probeCollection?.edges.map(
            (e) => e.node.id,
          );
          expect([...(ids ?? [])].sort(), JSON.stringify(probeResult)).toEqual(
            [...fixtures.probe.A].sort(),
          );
        });

        it("mitigación: sin `public` en el search_path no se refleja ninguna tabla de la app", async () => {
          for (const collection of APP_COLLECTIONS) {
            const result = await resolveAs(
              "graphql_public, extensions, spike_exposed",
              `{ ${collection} { edges { node { __typename } } } }`,
            );
            expect(
              result.data?.[collection],
              JSON.stringify(result),
            ).toBeFalsy();
          }
        });
      });
    });
  },
);
