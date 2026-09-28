import type { SpikeTarget } from "./env";

/*
 * Fixtures comunes (§9 del plan):
 *   uA  admin de A           uB  seller de B
 *   uAB seller de A + admin de B (cambio de org, user_org_ids múltiple)
 *   uC  sin membership        uD  membership INACTIVA en A
 */
export type UserKey = "uA" | "uB" | "uAB" | "uC" | "uD";
export type OrgKey = "A" | "B";

export type FixtureUser = {
  readonly id: string;
  readonly email: string;
  readonly accessToken: string;
};

export type SetupMeta = {
  readonly target: SpikeTarget;
  readonly serverVersion: string;
  readonly postgresRole: {
    readonly rolsuper: boolean;
    readonly rolbypassrls: boolean;
    readonly rolcreaterole: boolean;
  };
  readonly appTableOwner: string;
  readonly q1Grant: {
    readonly exists: boolean;
    readonly inherit: boolean | null;
    readonly set: boolean | null;
    readonly admin: boolean | null;
  };
  readonly authUidDefinition: string;
  readonly accessTokenHeader: Record<string, unknown> | null;
  readonly publishableKeyKind: string;
  readonly secretKeyKind: string;
  readonly pooler: {
    readonly postgres: string;
    readonly appRuntime: string;
  };
  /** Extensiones instaladas (p. ej. si pg_graphql está activo en staging). */
  readonly extensions: readonly string[];
  /** Settings del rol `authenticator` (config de PostgREST, si vive en la base). */
  readonly authenticatorConfig: readonly string[] | null;
  /** Identificador de la corrida: prefijo de usuarios y organizaciones sintéticos. */
  readonly runId: string;
};

export type Fixtures = {
  readonly target: SpikeTarget;
  readonly orgs: Record<OrgKey, string>;
  readonly users: Record<UserKey, FixtureUser>;
  /** ids de tenant_probe por organización (A: 2 filas, B: 1 fila). */
  readonly probe: Record<OrgKey, readonly string[]>;
  readonly meta: SetupMeta;
};

declare module "vitest" {
  export interface ProvidedContext {
    fixtures: Fixtures;
  }
}
