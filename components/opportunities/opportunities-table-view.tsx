"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";

import { STAGE_TONES } from "@/components/opportunities/stage-badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ConversationsIcon,
  SearchIcon,
  SortIcon,
  SwapIcon,
  type IconProps,
} from "@/components/ui/icons";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import type { PurchaseType } from "@/domains/demand/facts";
import {
  PURCHASE_TYPE_LABELS,
  UNDEFINED_VEHICLE,
} from "@/domains/demand/presentation";
import { stageLabel } from "@/domains/opportunities/labels";
import { searchedVehicle } from "@/domains/opportunities/prospect";
import {
  QUEUE_TABS,
  countByTab,
  type QueueTab,
} from "@/domains/opportunities/queue";
import { formatElapsedShort } from "@/domains/opportunities/recency";
import {
  DEFAULT_TABLE_PAGE_SIZE,
  DEFAULT_TABLE_SORT,
  TABLE_PAGE_SIZES,
  matchesTableQuery,
  nextTableSort,
  paginate,
  sortTableRows,
  tablePayment,
  tableSignals,
  type TablePage,
  type TablePageSize,
  type TableSignal,
  type TableSort,
  type TableSortKey,
} from "@/domains/opportunities/table";
import type { Opportunity } from "@/domains/opportunities/types";
import type { RecencyState, ScoreValue } from "@/domains/scoring/types";
import { RECENCY_STATE_LABELS } from "@/domains/scoring/types";
import { queueSelectionHref } from "@/lib/opportunities/paths";

import {
  NewOpportunityDrawer,
  type OpportunityCreated,
} from "./new-opportunity-drawer";
import { OpportunitiesViewSwitch } from "./opportunities-view-switch";

/*
 * Vista Tabla de Opportunities (DEC-055): el directorio de alta densidad de
 * la referencia, con datos reales de la cola. Cada fila: prospecto, vehículo
 * que busca y etapa; forma de pago; responsable; última actividad; señales;
 * y los cuatro scores de DEC-004, con la columna del Porandú resaltada en
 * azul hielo. Lo que no llega es "sin dato": sin cuotas, Lease ni Outreach.
 *
 * - La búsqueda, el orden y la paginación trabajan sobre lo que la cola ya
 *   leyó (domains/opportunities/table.ts): no hay otra lectura.
 * - Abrir una fila lleva a la cola con esa oportunidad seleccionada
 *   (`?op=`): la ficha de decisión vive ahí (DEC-015, DEC-017).
 * - En el teléfono, la tabla pasa a ser una lista de filas compactas con
 *   el color de la recencia.
 */

type OpportunitiesTableViewProps = {
  title: string;
  opportunities: readonly Opportunity[];
  referenceMinuteOfDay: number;
};

const SCORE_COLUMNS: readonly {
  key: Exclude<TableSortKey, "activity">;
  label: string;
}[] = [
  { key: "porandu", label: "Porandú" },
  { key: "intent", label: "Intent" },
  { key: "fit", label: "Vehicle Fit" },
  { key: "deal", label: "Deal" },
];

/** Texto de la etapa con el mismo tono que su badge (StageBadge). */
const STAGE_TEXT: Readonly<
  Record<(typeof STAGE_TONES)[keyof typeof STAGE_TONES], string>
> = {
  neutral: "text-text-muted",
  brand: "text-brand",
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger",
};

const PAYMENT_PILL: Readonly<Record<PurchaseType, string>> = {
  cash: "border-info-border bg-info-soft text-info",
  financed: "border-accent-border bg-accent-soft text-accent-strong",
  undecided: "border-border-default bg-surface-2 text-text-secondary",
};

const RECENCY_DOT: Readonly<Record<RecencyState, string>> = {
  active: "bg-success",
  warning: "bg-warning-bright",
  stale: "bg-danger",
};

/** Fondo de la fila compacta del teléfono según la recencia. */
const RECENCY_ROW: Readonly<Record<RecencyState, string>> = {
  active: "border-success-border bg-success-soft",
  warning: "border-warning-border bg-warning-soft",
  stale: "border-border-subtle bg-surface-1",
};

const SIGNALS: Readonly<
  Record<
    TableSignal,
    { label: string; icon: (props: IconProps) => ReactNode; tone: string }
  >
> = {
  live: {
    label: "Conversación de WhatsApp en vivo",
    icon: ConversationsIcon,
    tone: "border-success-border bg-success-soft text-success",
  },
  tradeIn: {
    label: "Entrega un usado",
    icon: SwapIcon,
    tone: "border-info-border bg-info-soft text-info",
  },
  urgent: {
    label: "Riesgo de pérdida: retomar contacto",
    icon: AlertIcon,
    tone: "border-danger-border bg-danger-soft text-danger",
  },
};

export function OpportunitiesTableView({
  title,
  opportunities,
  referenceMinuteOfDay,
}: OpportunitiesTableViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<QueueTab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSort>(DEFAULT_TABLE_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(
    DEFAULT_TABLE_PAGE_SIZE,
  );
  const [created, setCreated] = useState<OpportunityCreated | null>(null);

  const inTab = opportunities.filter(
    (opportunity) => tab === "all" || opportunity.bucket === tab,
  );
  const filtered = inTab.filter((opportunity) =>
    matchesTableQuery(opportunity, query),
  );
  const current = paginate(sortTableRows(filtered, sort), page, pageSize);

  const openRow = (event: MouseEvent, opportunityId: string) => {
    // El enlace del nombre navega solo; el resto de la fila es un atajo.
    if ((event.target as HTMLElement).closest("a, button")) return;
    router.push(queueSelectionHref(opportunityId, "table"));
  };

  const sortBy = (key: TableSortKey) => {
    setSort((previous) => nextTableSort(previous, key));
    setPage(1);
  };

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <h1 className="sr-only">{title}</h1>

        <section
          aria-label="Tabla de oportunidades"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card"
        >
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border-subtle px-4 pt-3">
            <OpportunitiesViewSwitch
              current="table"
              className="mb-2.5 w-full sm:w-72"
            />
            <div
              role="group"
              aria-label="Filtrar por urgencia"
              className="flex gap-4 overflow-x-auto sm:gap-5"
            >
              {QUEUE_TABS.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setTab(item.id);
                      setPage(1);
                    }}
                    className={cn(
                      "-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-0.5 text-label whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                      active
                        ? "border-brand font-semibold text-text-primary"
                        : "border-transparent text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {item.label}
                    <span
                      className={cn(
                        "tabular-nums",
                        active ? "text-brand" : "text-text-muted",
                      )}
                    >
                      {countByTab(opportunities, item.id)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-border-subtle px-4 py-2.5">
            <p
              role="status"
              className="text-label text-text-secondary tabular-nums"
            >
              <span className="font-semibold text-text-primary">
                {filtered.length}
              </span>{" "}
              {filtered.length === 1 ? "resultado" : "resultados"}
              {filtered.length !== opportunities.length ? (
                <span className="text-text-muted">
                  {" "}
                  (filtrado de {opportunities.length})
                </span>
              ) : null}
            </p>
            <label className="relative flex min-w-0 flex-1 items-center sm:max-w-72">
              <span className="sr-only">
                Buscar por prospecto, vehículo o responsable
              </span>
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 size-4 text-text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar prospecto, vehículo…"
                className="h-8 w-full rounded-md border border-border-default bg-surface-1 pr-2.5 pl-8 text-label text-text-primary placeholder:text-text-muted hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
              />
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <NewOpportunityDrawer
                triggerVariant="success"
                triggerClassName=""
                onCreated={(result) => {
                  setTab("all");
                  setQuery("");
                  setCreated(result);
                }}
              />
              <Pager
                page={current}
                pageSize={pageSize}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                onPage={setPage}
              />
            </div>
          </div>

          <CreatedNotice created={created} onDismiss={() => setCreated(null)} />

          <div className="min-h-0 flex-1 overflow-auto">
            {current.items.length === 0 ? (
              <EmptyState hasOpportunities={opportunities.length > 0} />
            ) : (
              <>
                <table className="w-full min-w-[62rem] border-separate border-spacing-0 text-left max-md:hidden">
                  <caption className="sr-only">
                    Oportunidades con sus scores. Abrí una fila para ver la
                    ficha de decisión.
                  </caption>
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-inverse text-text-inverse">
                      <HeaderCell>Prospecto / vehículo</HeaderCell>
                      <HeaderCell>Pago</HeaderCell>
                      <HeaderCell>Responsable</HeaderCell>
                      <SortableHeader
                        column="activity"
                        label="Actividad"
                        sort={sort}
                        onSort={sortBy}
                      />
                      <HeaderCell>Señales</HeaderCell>
                      {SCORE_COLUMNS.map((column) => (
                        <SortableHeader
                          key={column.key}
                          column={column.key}
                          label={column.label}
                          sort={sort}
                          onSort={sortBy}
                          align="center"
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.items.map((opportunity) => (
                      <TableRow
                        key={opportunity.id}
                        opportunity={opportunity}
                        elapsed={formatElapsedShort(
                          opportunity.lastActivity.minutes,
                          referenceMinuteOfDay,
                        )}
                        onOpen={openRow}
                      />
                    ))}
                  </tbody>
                </table>

                <ul
                  aria-label="Oportunidades"
                  className="flex flex-col gap-2 p-3 md:hidden"
                >
                  {current.items.map((opportunity) => (
                    <CompactRow
                      key={opportunity.id}
                      opportunity={opportunity}
                      elapsed={formatElapsedShort(
                        opportunity.lastActivity.minutes,
                        referenceMinuteOfDay,
                      )}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-overline font-semibold whitespace-nowrap uppercase"
    >
      {children}
    </th>
  );
}

function SortableHeader({
  column,
  label,
  sort,
  onSort,
  align = "start",
}: {
  column: TableSortKey;
  label: string;
  sort: TableSort;
  onSort: (column: TableSortKey) => void;
  align?: "start" | "center";
}) {
  const active = sort.key === column;
  const Icon = !active
    ? SortIcon
    : sort.direction === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
      className={cn(
        "px-2 py-1.5 whitespace-nowrap",
        align === "center" && "text-center",
        column === "porandu" && "bg-surface-inverse-raised",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-sm px-2 text-overline font-semibold uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring-inverse",
          active
            ? "text-text-inverse"
            : "text-text-inverse-muted hover:text-text-inverse",
        )}
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </th>
  );
}

function ScoreCell({
  value,
  highlighted = false,
}: {
  value: ScoreValue;
  highlighted?: boolean;
}) {
  return (
    <td
      className={cn(
        "border-b border-border-subtle px-3 text-center tabular-nums",
        highlighted
          ? "bg-navy-soft text-title font-bold text-navy-strong"
          : "text-body text-text-secondary",
      )}
    >
      {value ?? <span className="text-text-muted">—</span>}
      {value === null ? <span className="sr-only"> sin dato</span> : null}
    </td>
  );
}

function PaymentPill({ payment }: { payment: PurchaseType | null }) {
  if (payment === null) {
    return <span className="text-label text-text-muted">Sin dato</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap",
        PAYMENT_PILL[payment],
      )}
    >
      {PURCHASE_TYPE_LABELS[payment]}
    </span>
  );
}

function Signals({ opportunity }: { opportunity: Opportunity }) {
  const signals = tableSignals(opportunity);
  if (signals.length === 0) {
    return <span className="text-label text-text-muted">—</span>;
  }
  return (
    <ul className="flex items-center gap-1.5">
      {signals.map((signal) => {
        const { label, icon: Icon, tone } = SIGNALS[signal];
        return (
          <li key={signal}>
            <Tooltip content={label}>
              <span
                tabIndex={0}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
                  tone,
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span className="sr-only">{label}</span>
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function Activity({
  state,
  elapsed,
}: {
  state: RecencyState | undefined;
  elapsed: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-secondary tabular-nums">
      {state ? (
        <>
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", RECENCY_DOT[state])}
          />
          <span className="sr-only">{RECENCY_STATE_LABELS[state]}, </span>
        </>
      ) : null}
      {elapsed}
    </span>
  );
}

function TableRow({
  opportunity,
  elapsed,
  onOpen,
}: {
  opportunity: Opportunity;
  elapsed: string;
  onOpen: (event: MouseEvent, opportunityId: string) => void;
}) {
  const { prospect, owner, scores, stage } = opportunity;
  const vehicle = searchedVehicle(opportunity);
  const cell = "border-b border-border-subtle px-4 py-3";
  return (
    <tr
      onClick={(event) => onOpen(event, opportunity.id)}
      className="group cursor-pointer bg-surface-1 transition-colors hover:bg-surface-2"
    >
      <td className={cell}>
        <div className="flex items-center gap-3">
          <Avatar initials={prospect.initials} size="md" />
          <div className="min-w-0">
            <Link
              href={queueSelectionHref(opportunity.id, "table")}
              prefetch={false}
              className="rounded-sm text-body font-semibold text-text-primary group-hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {prospect.name}
            </Link>
            <p className="truncate text-label text-text-secondary">
              <span className="font-semibold text-text-primary">
                {vehicle ?? UNDEFINED_VEHICLE}
              </span>
            </p>
            <p
              className={cn(
                "text-caption font-semibold",
                STAGE_TEXT[STAGE_TONES[stage]],
              )}
            >
              {stageLabel(stage)}
            </p>
          </div>
        </div>
      </td>
      <td className={cell}>
        <PaymentPill payment={tablePayment(opportunity)} />
      </td>
      <td className={cn(cell, "text-label text-text-secondary")}>
        {owner ? (
          <span className="block max-w-32 leading-4">{owner.name}</span>
        ) : (
          <span className="text-text-muted">Sin asignar</span>
        )}
      </td>
      <td className={cn(cell, "text-label")}>
        <Activity state={opportunity.lastActivity.state} elapsed={elapsed} />
      </td>
      <td className={cell}>
        <Signals opportunity={opportunity} />
      </td>
      <ScoreCell value={scores.porandu} highlighted />
      <ScoreCell value={scores.intent} />
      <ScoreCell value={scores.fit} />
      <ScoreCell value={scores.deal} />
    </tr>
  );
}

/** Inicial de la forma de pago en el círculo de la fila compacta. */
const PAYMENT_INITIAL: Readonly<Record<PurchaseType, string>> = {
  cash: "C",
  financed: "F",
  undecided: "?",
};

function CompactRow({
  opportunity,
  elapsed,
}: {
  opportunity: Opportunity;
  elapsed: string;
}) {
  const { prospect, scores, stage, lastActivity } = opportunity;
  const vehicle = searchedVehicle(opportunity);
  const payment = tablePayment(opportunity);
  return (
    <li>
      <Link
        href={queueSelectionHref(opportunity.id, "table")}
        prefetch={false}
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2.5 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          lastActivity.state
            ? RECENCY_ROW[lastActivity.state]
            : "border-border-subtle bg-surface-1",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-semibold text-text-primary">
            {prospect.name}
          </span>
          <span className="block truncate text-caption text-text-secondary">
            {vehicle ?? UNDEFINED_VEHICLE}
          </span>
          <span className="flex items-center gap-2 text-caption">
            <span
              className={cn("font-semibold", STAGE_TEXT[STAGE_TONES[stage]])}
            >
              {stageLabel(stage)}
            </span>
            <Activity state={lastActivity.state} elapsed={elapsed} />
          </span>
        </span>
        {payment ? (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border text-caption font-bold",
              PAYMENT_PILL[payment],
            )}
          >
            <span aria-hidden="true">{PAYMENT_INITIAL[payment]}</span>
            <span className="sr-only">{PURCHASE_TYPE_LABELS[payment]}</span>
          </span>
        ) : null}
        <span className="flex w-14 shrink-0 flex-col items-center rounded-md bg-navy-soft py-1 text-navy-strong">
          <span className="text-[0.625rem] leading-3 font-semibold uppercase">
            Porandú
          </span>
          <span className="text-heading font-bold tabular-nums">
            {scores.porandu ?? "—"}
            {scores.porandu === null ? (
              <span className="sr-only"> sin dato</span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Pager({
  page,
  pageSize,
  onPageSize,
  onPage,
}: {
  page: TablePage<Opportunity>;
  pageSize: TablePageSize;
  onPageSize: (size: TablePageSize) => void;
  onPage: (page: number) => void;
}) {
  const button =
    "flex size-8 items-center justify-center rounded-md border border-border-default bg-surface-1 text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav aria-label="Páginas" className="flex items-center gap-2">
      {page.total > 0 ? (
        <span className="text-label whitespace-nowrap text-text-muted tabular-nums">
          Mostrando {page.from}–{page.to}
        </span>
      ) : null}
      <label className="flex items-center">
        <span className="sr-only">Filas por página</span>
        <select
          value={pageSize}
          onChange={(event) =>
            onPageSize(Number(event.target.value) as TablePageSize)
          }
          className="h-8 rounded-md border border-border-default bg-surface-1 px-2 text-label text-text-primary hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {TABLE_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="Página anterior"
        disabled={page.page <= 1}
        onClick={() => onPage(page.page - 1)}
        className={button}
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Página siguiente"
        disabled={page.page >= page.pageCount}
        onClick={() => onPage(page.page + 1)}
        className={button}
      >
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

/**
 * Confirmación del alta desde la tabla, con el enlace a su ficha de
 * decisión. Región `status` que existe siempre, para que se anuncie.
 */
function CreatedNotice({
  created,
  onDismiss,
}: {
  created: OpportunityCreated | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className={created ? "px-4 pt-3" : "sr-only"}>
      {created ? (
        <p className="flex items-center gap-3 rounded-md border border-success-border bg-success-soft py-2 pr-1.5 pl-3 text-label text-success">
          <span className="min-w-0 flex-1">
            {created.contactReused
              ? `Oportunidad creada. El teléfono ya era de ${created.contactName}: se usó ese contacto, sin cambios.`
              : `Oportunidad creada para ${created.contactName}.`}{" "}
            <Link
              href={queueSelectionHref(created.opportunityId, "table")}
              prefetch={false}
              className="font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Abrir su ficha
            </Link>
          </span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onDismiss}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-success-border/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({ hasOpportunities }: { hasOpportunities: boolean }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-heading text-text-primary">
        {hasOpportunities
          ? "Ninguna oportunidad coincide"
          : "Todavía no hay oportunidades"}
      </p>
      <p className="mt-1 text-label text-text-muted">
        {hasOpportunities
          ? "Probá con otra búsqueda o con otra pestaña."
          : "Cargá la primera con «Nueva oportunidad»."}
      </p>
    </div>
  );
}
