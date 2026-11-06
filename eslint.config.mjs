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

// Hito 7 (DEC-039 §4): withIngestion() es la puerta del sistema, sin
// usuario: asume authenticated sin claims para ejecutar las funciones de
// ingesta de WhatsApp. Solo la usan db/queries/ingest-whatsapp-message.ts
// (mensajes entrantes) y db/queries/ingest-whatsapp-status.ts (estados de
// entrega, Hito 12C, DEC-044 §3.3).
const WITH_INGESTION_MESSAGE =
  "withIngestion() is the system door for the WhatsApp ingestion only (db/queries/ingest-whatsapp-message.ts and db/queries/ingest-whatsapp-status.ts). Tenant-scoped data goes through requireTenant() + withTenant().";
const withIngestionImport = {
  regex: "(^|/)db/tenant$|^\\.{1,2}/tenant$",
  importNames: ["withIngestion"],
  message: WITH_INGESTION_MESSAGE,
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

// Hito 19 (DEC-051): el ciclo de vida de una unidad desde Stock
// (poner en el salón, reservar, liberar) tiene una sola puerta, la Server
// Action changeVehicleStatus() (lib/vehicles/actions.ts), que obtiene el
// contexto con requireTenant() y valida el pedido antes de escribir. Vender
// no pasa por acá: lo hace el cierre Ganada (closeOpportunity()).
const CHANGE_VEHICLE_STATUS_MESSAGE =
  "Vehicle statuses change only through the changeVehicleStatus() Server Action (lib/vehicles/actions.ts): requireTenant(), server-side validation, then withTenant(). A sale happens only when the opportunity is closed as won (closeOpportunity()).";
const changeVehicleStatusImport = {
  regex:
    "(^|/)db/queries/change-vehicle-status$|^\\.{1,2}/change-vehicle-status$",
  // Los tipos del resultado (VehicleStatusChangeOutcome) no escriben nada.
  allowTypeImports: true,
  message: CHANGE_VEHICLE_STATUS_MESSAGE,
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

// Hito 4 (DEC-036 §6): los mensajes tienen una sola puerta, la Server Action
// addMessage() (lib/conversations/actions.ts), que obtiene el contexto con
// requireTenant() y valida el pedido antes de escribir.
const RECORD_MESSAGE_MESSAGE =
  "Messages are recorded only through the addMessage() Server Action (lib/conversations/actions.ts): requireTenant(), server-side validation, then withTenant().";
const recordMessageImport = {
  regex: "(^|/)db/queries/record-message$|^\\.{1,2}/record-message$",
  // Los tipos del resultado (MessageWriteOutcome) no escriben nada.
  allowTypeImports: true,
  message: RECORD_MESSAGE_MESSAGE,
};

// Hito 6 (DEC-038 §5): la configuración del concesionario y el equipo
// tienen una sola puerta, las Server Actions de lib/settings/actions.ts
// (updateOrganization(), inviteMember(), updateMemberRole() y
// removeMember()), que obtienen el contexto con requireTenant(), exigen rol
// admin y validan el pedido antes de escribir.
const SETTINGS_WRITE_MESSAGE =
  "Organization settings and team memberships are written only through the Server Actions in lib/settings/actions.ts: requireTenant(), admin role, server-side validation, then withTenant().";
const settingsWriteImport = {
  regex: "(^|/)db/queries/settings-write$|^\\.{1,2}/settings-write$",
  // Los tipos de los resultados no escriben nada.
  allowTypeImports: true,
  message: SETTINGS_WRITE_MESSAGE,
};

// Hito 7 (DEC-039): la ingesta de mensajes entrantes de WhatsApp tiene una
// sola puerta, el webhook (lib/whatsapp/webhook.ts), que verifica la firma
// y valida el payload antes de escribir. Hito 12C (DEC-044 §3.3): también
// la de los estados de entrega de los salientes.
const INGEST_WHATSAPP_MESSAGE =
  "Inbound WhatsApp messages and delivery statuses are ingested only through the webhook (lib/whatsapp/webhook.ts): signature, server-side validation, then withIngestion().";
const ingestWhatsAppImport = {
  regex:
    "(^|/)db/queries/ingest-whatsapp-(message|status)$|^\\.{1,2}/ingest-whatsapp-(message|status)$",
  // Los tipos de los resultados (InboundMessageOutcome,
  // DeliveryStatusOutcome) no escriben nada.
  allowTypeImports: true,
  message: INGEST_WHATSAPP_MESSAGE,
};

// Hito 8 (DEC-040 §9): el envío de mensajes de WhatsApp tiene una sola
// puerta, POST /api/messages/send (lib/conversations/send.ts), que resuelve
// el tenant y valida el pedido antes de leer el destino y registrar.
const SEND_MESSAGE_MESSAGE =
  "WhatsApp messages are sent only through POST /api/messages/send (lib/conversations/send.ts): resolveRequestTenant(), server-side validation, then withTenant().";
const sendMessageImport = {
  regex: "(^|/)db/queries/outbound-message$|^\\.{1,2}/outbound-message$",
  // Los tipos de los resultados (SendTarget, OutboundMessageOutcome) no
  // escriben nada.
  allowTypeImports: true,
  message: SEND_MESSAGE_MESSAGE,
};

// Hito 8 (DEC-040 §5): el cliente de la Cloud API de Meta envía mensajes
// irreversibles. Solo lo usa la puerta del envío, que dispara un miembro.
const WHATSAPP_API_MESSAGE =
  "The Meta Cloud API client (lib/whatsapp/api.ts) is used only by POST /api/messages/send (lib/conversations/send.ts): a member always triggers a send.";
const whatsappApiImport = {
  regex: "(^|/)lib/whatsapp/api$|^\\./api$",
  // Los tipos del cliente no envían nada.
  allowTypeImports: true,
  message: WHATSAPP_API_MESSAGE,
};

// Hito 9 (DEC-041 §3): la agenda de pruebas de manejo tiene una sola
// puerta, las Server Actions de lib/calendar/actions.ts (scheduleTestDrive()
// y changeTestDriveStatus()), que obtienen el contexto con requireTenant() y
// validan el pedido antes de escribir.
const TEST_DRIVES_WRITE_MESSAGE =
  "Test drives are written only through the Server Actions in lib/calendar/actions.ts: requireTenant(), server-side validation, then withTenant().";
const testDrivesWriteImport = {
  regex: "(^|/)db/queries/test-drives-write$|^\\.{1,2}/test-drives-write$",
  // Los tipos de los resultados no escriben nada.
  allowTypeImports: true,
  message: TEST_DRIVES_WRITE_MESSAGE,
};

// Hito 10 (DEC-042 §8): las cotizaciones tienen una sola puerta, las Server
// Actions de lib/quotes/actions.ts (createQuote() y changeQuoteStatus()),
// que obtienen el contexto con requireTenant() y leen el pedido antes de
// escribir.
const QUOTES_WRITE_MESSAGE =
  "Quotes are written only through the Server Actions in lib/quotes/actions.ts: requireTenant(), server-side validation, then withTenant().";
const quotesWriteImport = {
  regex: "(^|/)db/queries/quotes-write$|^\\.{1,2}/quotes-write$",
  // Los tipos de los resultados no escriben nada.
  allowTypeImports: true,
  message: QUOTES_WRITE_MESSAGE,
};

// Hito 12B (DEC-044 §2.7): el cursor de leído de la bandeja tiene una sola
// puerta, la Server Action markConversationRead() (lib/conversations/read.ts),
// que obtiene el contexto con requireTenant() y valida el pedido antes de
// escribir. Las lecturas del mismo módulo (los contadores y el cursor, que
// usa el loader de /conversations) no escriben y se pueden importar.
const CONVERSATION_READ_MESSAGE =
  "Conversations are marked as read only through the markConversationRead() Server Action (lib/conversations/read.ts): requireTenant(), server-side validation, then withTenant().";
const conversationReadImport = {
  regex: "(^|/)db/queries/conversation-reads$|^\\.{1,2}/conversation-reads$",
  importNames: ["recordConversationRead"],
  message: CONVERSATION_READ_MESSAGE,
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

// Hito 14 (DEC-046 §4): pdf-lib solo vive detrás del generador del
// presupuesto, lib/quotes/pdf.ts (`import "server-only"`). Ni la UI ni el
// dominio lo conocen: el PDF se genera en el servidor, desde la base, en
// GET /api/quotes/[quoteId]/pdf, y la librería no llega al bundle del
// navegador.
const PDF_LIBRARY_MESSAGE =
  "PDF generation is server-only: use renderQuotePdf() from lib/quotes/pdf.ts (GET /api/quotes/[quoteId]/pdf).";
const pdfLibraryImport = {
  regex: "^pdf-lib(/|$)",
  message: PDF_LIBRARY_MESSAGE,
};

// Embudo de ventas (propuesta DEC-048): @dnd-kit (el arrastre del tablero)
// solo vive en components/pipeline/. El resto de la UI no arrastra nada, y
// el dominio y el servidor no conocen la librería: las reglas de movimiento
// son la máquina de DEC-032 (domains/opportunities/pipeline-moves.ts).
const DND_LIBRARY_MESSAGE =
  "Drag and drop lives only in the pipeline board (components/pipeline/). Moves follow the stage machine in domains/opportunities/pipeline-moves.ts.";
const dndLibraryImport = {
  regex: "^@dnd-kit(/|$)",
  message: DND_LIBRARY_MESSAGE,
};

const basePatterns = [
  dbClientImport,
  withUserImport,
  withIngestionImport,
  resolveTenantImport,
  opportunitiesMockImport,
  createOpportunityImport,
  createVehicleImport,
  changeVehicleStatusImport,
  changeOpportunityStageImport,
  closeOpportunityImport,
  recordOpportunityNoteImport,
  linkOpportunityVehicleImport,
  recordMessageImport,
  settingsWriteImport,
  ingestWhatsAppImport,
  sendMessageImport,
  whatsappApiImport,
  demandFactsImport,
  phoneLibraryImport,
  testDrivesWriteImport,
  quotesWriteImport,
  conversationReadImport,
  pdfLibraryImport,
  dndLibraryImport,
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
  // Únicos módulos que arrastran: el tablero del embudo (propuesta DEC-048).
  // Siguen sin conocer Drizzle ni el boundary, como el resto de la UI.
  {
    files: ["components/pipeline/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...basePatterns.filter((pattern) => pattern !== dndLibraryImport),
            dataLayerImport,
          ],
        },
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
  // Hito 12B: el índice del schema reexporta la tabla conversation_reads
  // (db/schema/conversation-reads.ts). El guard del cursor de leído es del
  // módulo de escritura de db/queries, que tiene el mismo nombre de archivo.
  {
    files: ["db/schema/index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...basePatterns.filter(
              (pattern) => pattern !== conversationReadImport,
            ),
            dbClientRelativeImport,
          ],
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
  // Stock (H1.3A, H1.3B, el catálogo de la propuesta DEC-049 y el ciclo de
  // vida de la DEC-051): una sola fuente, PostgreSQL. Ni la lista,
  // ni el catálogo, ni el alta rápida, ni los cambios de estado tienen
  // fixtures.
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
      "db/queries/change-vehicle-status.ts",
      "db/queries/stock-catalog.ts",
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
            withIngestionImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            changeVehicleStatusImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            demandFactsImport,
            phoneLibraryImport,
            testDrivesWriteImport,
            quotesWriteImport,
            conversationReadImport,
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
            withIngestionImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            changeVehicleStatusImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            demandFactsImport,
            phoneLibraryImport,
            testDrivesWriteImport,
            quotesWriteImport,
            conversationReadImport,
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
            withIngestionImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createVehicleImport,
            changeVehicleStatusImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            phoneLibraryImport,
            testDrivesWriteImport,
            quotesWriteImport,
            conversationReadImport,
          ],
        },
      ],
    },
  },
  // Única puerta de la configuración y del equipo (Hito 6, DEC-038 §5).
  {
    files: ["lib/settings/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== settingsWriteImport,
          ),
        },
      ],
    },
  },
  // Única puerta de las cotizaciones (Hito 10, DEC-042 §8).
  {
    files: ["lib/quotes/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== quotesWriteImport,
          ),
        },
      ],
    },
  },
  // Única puerta de la agenda de pruebas de manejo (Hito 9, DEC-041 §3).
  {
    files: ["lib/calendar/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== testDrivesWriteImport,
          ),
        },
      ],
    },
  },
  // Única puerta del cursor de leído de la bandeja (Hito 12B, DEC-044 §2.7).
  {
    files: ["lib/conversations/read.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== conversationReadImport,
          ),
        },
      ],
    },
  },
  // Única puerta del registro de mensajes (Hito 4, DEC-036 §6).
  {
    files: ["lib/conversations/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== recordMessageImport,
          ),
        },
      ],
    },
  },
  // Única puerta del alta rápida (H1.3B) y del ciclo de vida (Hito 19) de
  // las unidades. Sin fixtures.
  {
    files: ["lib/vehicles/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            dbClientImport,
            withUserImport,
            withIngestionImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            demandFactsImport,
            phoneLibraryImport,
            testDrivesWriteImport,
            quotesWriteImport,
            conversationReadImport,
            stockMockImport,
          ],
        },
      ],
    },
  },
  // Única puerta del envío de mensajes de WhatsApp (Hito 8, DEC-040 §9): la
  // lectura del destino, el registro y el cliente de Meta.
  {
    files: ["lib/conversations/send.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) =>
              pattern !== sendMessageImport && pattern !== whatsappApiImport,
          ),
        },
      ],
    },
  },
  // Única puerta de la ingesta de mensajes entrantes de WhatsApp (Hito 7,
  // DEC-039) y de sus estados de entrega (Hito 12C, DEC-044 §3.3).
  {
    files: ["lib/whatsapp/webhook.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== ingestWhatsAppImport,
          ),
        },
      ],
    },
  },
  // Únicos módulos que importan withIngestion() (Hito 7, DEC-039 §4; Hito
  // 12C, DEC-044 §3.3).
  {
    files: [
      "db/queries/ingest-whatsapp-message.ts",
      "db/queries/ingest-whatsapp-status.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...basePatterns.filter(
              (pattern) => pattern !== withIngestionImport,
            ),
            dbClientRelativeImport,
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
            withIngestionImport,
            resolveTenantImport,
            opportunitiesMockImport,
            createOpportunityImport,
            createVehicleImport,
            changeVehicleStatusImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            demandFactsImport,
          ],
        },
      ],
    },
  },
  // Único módulo que importa pdf-lib (solo servidor, Hito 14).
  {
    files: ["lib/quotes/pdf.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: basePatterns.filter(
            (pattern) => pattern !== pdfLibraryImport,
          ),
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
            changeVehicleStatusImport,
            changeOpportunityStageImport,
            closeOpportunityImport,
            recordOpportunityNoteImport,
            linkOpportunityVehicleImport,
            recordMessageImport,
            settingsWriteImport,
            ingestWhatsAppImport,
            sendMessageImport,
            whatsappApiImport,
            demandFactsImport,
            phoneLibraryImport,
            testDrivesWriteImport,
            quotesWriteImport,
            conversationReadImport,
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
