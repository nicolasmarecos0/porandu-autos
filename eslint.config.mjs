import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// ADR-001 §2/§3.1: la credencial de migración (postgres) no se lee en
// runtime. Solo drizzle.config.ts se exceptúa.
const MIGRATION_URL_MESSAGE =
  "MIGRATION_DATABASE_URL is migration-only (ADR-001). Runtime code uses RUNTIME_DATABASE_URL via lib/env.server.ts.";
const noMigrationUrl = [
  {
    selector:
      "MemberExpression[property.name='MIGRATION_DATABASE_URL'], MemberExpression[property.value='MIGRATION_DATABASE_URL']",
    message: MIGRATION_URL_MESSAGE,
  },
  {
    selector:
      "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='MIGRATION_DATABASE_URL']",
    message: MIGRATION_URL_MESSAGE,
  },
];

// A la inversa, drizzle.config.ts no puede leer RUNTIME_DATABASE_URL.
const RUNTIME_URL_MESSAGE =
  "drizzle-kit uses MIGRATION_DATABASE_URL only (ADR-001). RUNTIME_DATABASE_URL belongs to the application runtime.";
const noRuntimeUrl = [
  {
    selector:
      "MemberExpression[property.name='RUNTIME_DATABASE_URL'], MemberExpression[property.value='RUNTIME_DATABASE_URL']",
    message: RUNTIME_URL_MESSAGE,
  },
  {
    selector:
      "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='RUNTIME_DATABASE_URL']",
    message: RUNTIME_URL_MESSAGE,
  },
];

// DEC-006 / ADR-001: db/client es la conexión de bajo nivel. Solo
// db/tenant.ts (withUser/withTenant) la importa; los imports de tipos no
// abren conexiones y se permiten.
const DB_CLIENT_MESSAGE =
  "db/client is the low-level runtime connection (ADR-001). Access data through withUser()/withTenant() in db/tenant.ts.";
const dbClientImport = {
  regex: "(^|/)db/client$",
  allowTypeImports: true,
  message: DB_CLIENT_MESSAGE,
};
// Dentro de db/, también por ruta relativa (./client, ../client).
const dbClientRelativeImport = {
  regex: "^\\.{1,2}/client$",
  allowTypeImports: true,
  message: DB_CLIENT_MESSAGE,
};
// import() dinámico: no-restricted-imports no lo cubre.
const noDbClientDynamicImport = {
  selector: "ImportExpression[source.value=/(^|\\/)db\\/client$/]",
  message: DB_CLIENT_MESSAGE,
};
const noDbClientRelativeDynamicImport = {
  selector: "ImportExpression[source.value=/^\\.{1,2}\\/client$/]",
  message: DB_CLIENT_MESSAGE,
};

// H0.7 (ADR-001 §4): withUser() lee las memberships propias antes de elegir
// organización y no tiene organización: solo lo usa la query oficial
// (db/queries/memberships.ts). Todo lo demás pasa por withTenant().
const WITH_USER_MESSAGE =
  "withUser() only reads the user's own memberships (db/queries/memberships.ts). Tenant-scoped data goes through requireTenant() + withTenant().";
const withUserImport = {
  regex: "(^|/)db/tenant$|^\\.{1,2}/tenant$",
  importNames: ["withUser"],
  message: WITH_USER_MESSAGE,
};

// H0.7: resolveTenant() es el único que emite un TenantContext. Solo lo
// llama requireTenant() (lib/tenant/session.ts), después de verificar al
// usuario y leer sus memberships activas.
const RESOLVE_TENANT_MESSAGE =
  "Only requireTenant() (lib/tenant/session.ts) resolves the tenant. Get a TenantContext with requireTenant().";
const resolveTenantImport = {
  regex: "(^|/)lib/tenant/resolution$|^\\.{1,2}/(tenant/)?resolution$",
  importNames: ["resolveTenant"],
  message: RESOLVE_TENANT_MESSAGE,
};

// H1.1 (DEC-016, DEC-021): páginas y componentes no conocen Drizzle ni el
// boundary. Leen datos con los loaders de db/queries/, que llaman a
// requireTenant() y withTenant() junto a sus queries.
const DATA_LAYER_MESSAGE =
  "Pages and components read data through the loaders in db/queries/ (requireTenant() + withTenant()). They do not use Drizzle, db/schema or db/tenant directly.";
const dataLayerImport = {
  regex: "^drizzle-orm(/|$)|(^|/)db/(schema|tenant)(/|$)",
  allowTypeImports: true,
  message: DATA_LAYER_MESSAGE,
};

// DEC-016: domains/ solo tiene tipos, labels y lógica determinista. No
// depende de db/, mocks/, Drizzle, React ni Next.
const DOMAIN_MESSAGE =
  "domains/ holds types and pure logic only (DEC-016): no db/, mocks/, Drizzle, React or Next.";
const domainImport = {
  regex: "^(react|react-dom|next|drizzle-orm)(/|$)|(^|/)(db|mocks)(/|$)",
  message: DOMAIN_MESSAGE,
};

// H1.1: la cola de Opportunities se lee de PostgreSQL. El fixture de B1
// queda como referencia para tests, nunca como segunda fuente de la lista.
const OPPORTUNITIES_MOCK_MESSAGE =
  "The Opportunities queue is read from PostgreSQL (db/queries/opportunities.ts). mocks/opportunities is a test reference only.";
const opportunitiesMockImport = {
  regex: "(^|/)mocks/opportunities$",
  message: OPPORTUNITIES_MOCK_MESSAGE,
};

// H1.3A: la Stock List se lee de PostgreSQL. Ninguna fixture la alimenta:
// ni la página, ni sus componentes, ni su loader importan mocks/.
const STOCK_MOCK_MESSAGE =
  "The Stock List is read from PostgreSQL (db/queries/vehicles.ts). It has no fixtures in runtime: do not import mocks/.";
const stockMockImport = {
  regex: "(^|/)mocks(/|$)",
  message: STOCK_MOCK_MESSAGE,
};

// H1.2: el alta de una oportunidad tiene una sola puerta, la Server Action
// createOpportunity() (lib/opportunities/actions.ts), que obtiene el
// contexto con requireTenant() y valida el formulario antes de escribir.
const CREATE_OPPORTUNITY_MESSAGE =
  "Opportunities are created only through the createOpportunity() Server Action (lib/opportunities/actions.ts): requireTenant(), server-side validation, then withTenant().";
const createOpportunityImport = {
  regex: "(^|/)db/queries/create-opportunity$|^\\.{1,2}/create-opportunity$",
  // Los tipos del alta (NewOpportunity) no escriben nada.
  allowTypeImports: true,
  message: CREATE_OPPORTUNITY_MESSAGE,
};

// H1.3B: el alta rápida de una unidad tiene una sola puerta, la Server
// Action createVehicle() (lib/vehicles/actions.ts), que obtiene el contexto
// con requireTenant() y valida el formulario antes de escribir.
const CREATE_VEHICLE_MESSAGE =
  "Vehicles are created only through the createVehicle() Server Action (lib/vehicles/actions.ts): requireTenant(), server-side validation, then withTenant().";
const createVehicleImport = {
  regex: "(^|/)db/queries/create-vehicle$|^\\.{1,2}/create-vehicle$",
  // Los tipos del alta (NewVehicle) no escriben nada.
  allowTypeImports: true,
  message: CREATE_VEHICLE_MESSAGE,
};

// H1.3C: la transición in_preparation → available tiene una sola puerta, la
// Server Action markVehicleAvailable() (lib/vehicles/actions.ts), que
// obtiene el contexto con requireTenant() y valida el id antes de escribir.
const MARK_VEHICLE_AVAILABLE_MESSAGE =
  "Vehicles become available only through the markVehicleAvailable() Server Action (lib/vehicles/actions.ts): requireTenant(), server-side validation, then withTenant().";
const markVehicleAvailableImport = {
  regex:
    "(^|/)db/queries/mark-vehicle-available$|^\\.{1,2}/mark-vehicle-available$",
  // Los tipos del resultado (AvailabilityTransition) no escriben nada.
  allowTypeImports: true,
  message: MARK_VEHICLE_AVAILABLE_MESSAGE,
};

// H1.6 (DEC-032): el cambio de etapa de una oportunidad tiene una sola
// puerta, la Server Action changeOpportunityStage()
// (lib/opportunities/actions.ts), que obtiene el contexto con
// requireTenant() y valida el pedido antes de escribir.
const CHANGE_OPPORTUNITY_STAGE_MESSAGE =
  "Opportunity stages change only through the changeOpportunityStage() Server Action (lib/opportunities/actions.ts): requireTenant(), server-side validation, then withTenant().";
const changeOpportunityStageImport = {
  regex:
    "(^|/)db/queries/change-opportunity-stage$|^\\.{1,2}/change-opportunity-stage$",
  // Los tipos del resultado (StageChangeOutcome) no escriben nada.
  allowTypeImports: true,
  message: CHANGE_OPPORTUNITY_STAGE_MESSAGE,
};

// DEC-034 §6: el cierre comercial de una oportunidad (ganada o perdida, con
// sus metadatos) tiene una sola puerta, la Server Action closeOpportunity()
// (lib/opportunities/actions.ts), que obtiene el contexto con
// requireTenant() y valida el pedido antes de escribir.
const CLOSE_OPPORTUNITY_MESSAGE =
  "Opportunities are closed (won/lost with their closure metadata) only through the closeOpportunity() Server Action (lib/opportunities/actions.ts): requireTenant(), server-side validation, then withTenant().";
const closeOpportunityImport = {
  regex: "(^|/)db/queries/close-opportunity$|^\\.{1,2}/close-opportunity$",
  // Los tipos del resultado (CloseOpportunityOutcome) no escriben nada.
  allowTypeImports: true,
  message: CLOSE_OPPORTUNITY_MESSAGE,
};

// Hito 2 (DEC-033 §4): la bitácora comercial tiene una sola puerta, la
// Server Action addOpportunityNote() (lib/opportunities/actions.ts), que
// obtiene el contexto con requireTenant() y valida el texto antes de escribir.
const RECORD_OPPORTUNITY_NOTE_MESSAGE =
  "Opportunity notes are written only through the addOpportunityNote() Server Action (lib/opportunities/actions.ts): requireTenant(), server-side validation, then withTenant().";
const recordOpportunityNoteImport = {
  regex:
    "(^|/)db/queries/record-opportunity-note$|^\\.{1,2}/record-opportunity-note$",
  // Los tipos del resultado (NoteWriteOutcome) no escriben nada.
  allowTypeImports: true,
  message: RECORD_OPPORTUNITY_NOTE_MESSAGE,
};

// Hito 2 (DEC-033 §4): la unidad vinculada a una oportunidad tiene una sola
// puerta, la Server Action linkOpportunityVehicle()
// (lib/opportunities/actions.ts), que obtiene el contexto con
// requireTenant() y valida el pedido antes de escribir.
const LINK_OPPORTUNITY_VEHICLE_MESSAGE =
  "The vehicle linked to an opportunity changes only through the linkOpportunityVehicle() Server Action (lib/opportunities/actions.ts): requireTenant(), server-side validation, then withTenant().";
const linkOpportunityVehicleImport = {
  regex:
    "(^|/)db/queries/link-opportunity-vehicle$|^\\.{1,2}/link-opportunity-vehicle$",
  // Los tipos del resultado (VehicleLinkOutcome) no escriben nada.
  allowTypeImports: true,
  message: LINK_OPPORTUNITY_VEHICLE_MESSAGE,
};

// H1.4 (DEC-030 §8, C-8): la demanda tiene un único módulo de escritura,
// db/queries/demand-facts.ts. Lo usan solo el alta de una oportunidad
// (db/queries/create-opportunity.ts, en su misma transacción) y la Server
// Action recordDemand() (lib/opportunities/actions.ts), que obtiene el
// contexto con requireTenant() antes de escribir.
const DEMAND_FACTS_MESSAGE =
  "Demand facts are written only through db/queries/demand-facts.ts, from createOpportunityWithContact() (db/queries/create-opportunity.ts) and the recordDemand() Server Action (lib/opportunities/actions.ts).";
const demandFactsImport = {
  regex: "(^|/)db/queries/demand-facts$|^\\.{1,2}/demand-facts$",
  // Los tipos del resultado (DemandWriteOutcome) no escriben nada.
  allowTypeImports: true,
  message: DEMAND_FACTS_MESSAGE,
};

// H1.4: el ledger de demanda nunca usa ON CONFLICT. DO NOTHING descartaría
// en silencio un acto humano y DO UPDATE editaría una fila append-only: un
// choque de la cadena se re-planifica (compare-and-set).
const noDemandOnConflict = {
  selector:
    "CallExpression[callee.property.name=/^onConflictDo(Nothing|Update)$/]",
  message:
    "opportunity_demand_facts is append-only: never use ON CONFLICT. A chain conflict (23505/40P01) is re-planned (DEC-030 §4).",
};

// H1.2: libphonenumber-js (y su metadata) solo vive en el servidor, detrás
// de lib/contacts/phone.ts (`import "server-only"`).
const PHONE_LIBRARY_MESSAGE =
  "Phone parsing is server-only: use normalizePhone() from lib/contacts/phone.ts.";
const phoneLibraryImport = {
  regex: "^libphonenumber-js(/|$)",
  message: PHONE_LIBRARY_MESSAGE,
};

const basePatterns = [
  dbClientImport,
  withUserImport,
  resolveTenantImport,
  opportunitiesMockImport,
  createOpportunityImport,
  createVehicleImport,
  markVehicleAvailableImport,
  changeOpportunityStageImport,
  closeOpportunityImport,
  recordOpportunityNoteImport,
  linkOpportunityVehicleImport,
  demandFactsImport,
  phoneLibraryImport,
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noMigrationUrl,
        noDbClientDynamicImport,
      ],
      "no-restricted-imports": ["error", { patterns: basePatterns }],
    },
  },
  {
    files: ["app/**", "components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...basePatterns, dataLayerImport] },
      ],
    },
  },
  {
    files: ["domains/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...basePatterns, domainImport] },
      ],
    },
  },
  {
    files: ["db/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noMigrationUrl,
        noDbClientDynamicImport,
        noDbClientRelativeDynamicImport,
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [...basePatterns, dbClientRelativeImport],
        },
      ],
    },
  },
  // H1.4: el alta escribe la demanda en su misma transacción, por el único
  // módulo de escritura.
  {
    files: ["db/queries/create-opportunity.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...basePatterns.filter((pattern) => pattern !== demandFactsImport),
            dbClientRelativeImport,
          ],
        },
      ],
    },
  },
  {
    files: ["db/queries/demand-facts.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noMigrationUrl,
        noDbClientDynamicImport,
        noDbClientRelativeDynamicImport,
        noDemandOnConflict,
      ],
    },
  },
  // Stock (H1.3A, H1.3B, H1.3C): una sola fuente, PostgreSQL. Ni la lista,
  // ni el alta rápida, ni la disponibilidad tienen fixtures.
  {
    files: ["app/(app)/stock/**", "components/stock/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...basePatterns, dataLayerImport, stockMockImport] },
      ],
    },
  },
  {
    files: [
      "db/queries/vehicles.ts",
      "db/queries/create-vehicle.ts",
      "db/queries/mark-vehicle-available.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [...basePatterns, dbClientRelativeImport, stockMockImport],
        },
      ],
    },
  },
  {
    files: ["lib/vehicles/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...basePatterns, stockMockImport] },
      ],
    },
  },
  // Excepción única para las URLs: drizzle.config.ts lee
  // MIGRATION_DATABASE_URL y no puede leer RUNTIME_DATABASE_URL.
  {
    files: ["drizzle.config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noRuntimeUrl,
        noDbClientDynamicImport,
      ],
    },
  },
  // Los tests arman escenarios (contextos falsificados, memberships
  // revocadas) con withUser() y resolveTenant(). db/client sigue vedado.
  {
    files: ["tests/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [dbClientImport] }],
    },
  },
  // Único módulo que importa withUser(): la query de memberships propias.
  {
    files: ["db/queries/memberships.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            dbClientRelativeImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            markVehicleAvailableImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            demandFactsImport,
            phoneLibraryImport,
          ],
        },
      ],
    },
  },
  // Único módulo que importa resolveTenant(): requireTenant().
  {
    files: ["lib/tenant/session.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            withUserImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            markVehicleAvailableImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            demandFactsImport,
            phoneLibraryImport,
          ],
        },
      ],
    },
  },
  // Única puerta del alta de oportunidades (H1.2) y de la edición de la
  // demanda (H1.4, recordDemand()).
  {
    files: ["lib/opportunities/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            withUserImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createVehicleImport,
            markVehicleAvailableImport,
            phoneLibraryImport,
          ],
        },
      ],
    },
  },
  // Única puerta del alta rápida (H1.3B) y de la disponibilidad (H1.3C) de
  // unidades. Sin fixtures.
  {
    files: ["lib/vehicles/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            withUserImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            demandFactsImport,
            phoneLibraryImport,
            stockMockImport,
          ],
        },
      ],
    },
  },
  // Único módulo que importa libphonenumber-js (solo servidor).
  {
    files: ["lib/contacts/phone.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            withUserImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            markVehicleAvailableImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            demandFactsImport,
          ],
        },
      ],
    },
  },
  // Únicos módulos que acceden a db/client: el boundary y, en tests, la
  // prueba del propio cliente y el acceso de bajo nivel de tests/db.
  {
    files: ["db/tenant.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...noMigrationUrl],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            markVehicleAvailableImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            demandFactsImport,
            phoneLibraryImport,
          ],
        },
      ],
    },
  },
  {
    files: ["tests/unit/db/client.test.ts", "tests/db/support/runtime.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...noMigrationUrl],
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
