import { AlertIcon, SteeringIcon } from "@/components/ui/icons";
import type {
  AttentionView,
  CockpitMetrics,
  TestDrivePulseView,
} from "@/domains/cockpit/metrics";
import {
  ATTENTION_LABELS,
  TEST_DRIVE_OUTCOMES,
  testDriveRateBasis,
  type TestDriveOutcome,
} from "@/domains/cockpit/metrics-presentation";
import {
  countLabel,
  formatCount,
  formatPercent,
} from "@/domains/dashboard/presentation";

import { SegmentedBar, Swatch } from "./bars";
import { CALENDAR_HREF, QUEUE_HREF } from "./links";
import {
  DrillLink,
  MetricBand,
  MetricTile,
  MetricValue,
  PeriodTag,
  TodayTag,
} from "./metric-band";

/*
 * Pulso operativo (propuesta DEC-050 §6): el desempeño de la agenda en el
 * período y las oportunidades que hoy piden intervención de la gerencia.
 *
 * - Pruebas de manejo: la tasa de realización es realizadas sobre las que
 *   ya se debían. Los colores son los de la agenda (DEC-045 §5): Realizada
 *   verde, No asistió ámbar, Cancelada gris y, para las vencidas sin
 *   resultado, el tono de peligro: piden registrar qué pasó.
 * - Atención: Activas, Enfriándose e Inactivas con la regla de DEC-035 §2,
 *   en verde, ámbar y rojo, siempre junto a su rótulo.
 */

const OUTCOME_FILL: Readonly<Record<TestDriveOutcome, string>> = {
  completed: "bg-success",
  noShow: "bg-warning",
  cancelled: "bg-border-strong",
  overdue: "bg-danger",
};

type AttentionKey = keyof typeof ATTENTION_LABELS;

const ATTENTION_FILL: Readonly<Record<AttentionKey, string>> = {
  active: "bg-success",
  warning: "bg-warning",
  stale: "bg-danger",
};

const ATTENTION_ORDER: readonly AttentionKey[] = ["active", "warning", "stale"];

export function PulseBand({
  period,
  testDrives,
  attention,
}: Pick<CockpitMetrics, "period" | "testDrives" | "attention">) {
  return (
    <MetricBand
      id="metrics-pulse"
      title="Pulso operativo"
      description="Pruebas de manejo y oportunidades que se enfrían"
      icon={SteeringIcon}
    >
      <div className="grid gap-section md:grid-cols-2">
        <TestDriveTile period={period} testDrives={testDrives} />
        <AttentionTile attention={attention} />
      </div>
    </MetricBand>
  );
}

function TestDriveTile({
  period,
  testDrives,
}: {
  period: CockpitMetrics["period"];
  testDrives: TestDrivePulseView;
}) {
  return (
    <MetricTile
      title="Realización de pruebas de manejo"
      scope={<PeriodTag period={period} />}
      action={<DrillLink href={CALENDAR_HREF}>Ver agenda</DrillLink>}
    >
      <div className="flex flex-col gap-0.5">
        <MetricValue muted={testDrives.rate === null}>
          {formatPercent(testDrives.rate)}
        </MetricValue>
        <p className="text-caption text-text-muted">
          {testDrives.rate === null
            ? "Ninguna prueba con su horario cumplido en el período."
            : testDriveRateBasis(testDrives.completed, testDrives.due)}
        </p>
      </div>
      {testDrives.due > 0 ? (
        <SegmentedBar
          segments={TEST_DRIVE_OUTCOMES.map(({ id, label }) => ({
            key: id,
            label: `${label}: ${formatCount(testDrives[id])}`,
            value: testDrives[id],
            fill: OUTCOME_FILL[id],
          }))}
        />
      ) : null}
      <dl className="grid gap-x-6 gap-y-1.5 @md:grid-cols-2">
        {TEST_DRIVE_OUTCOMES.map(({ id, label }) => (
          <div
            key={id}
            className="flex items-baseline justify-between gap-2 text-label"
          >
            <dt className="flex min-w-0 items-center gap-1.5 text-text-secondary">
              <Swatch fill={OUTCOME_FILL[id]} />
              <span className="truncate">{label}</span>
            </dt>
            <dd className="font-semibold text-text-primary tabular-nums">
              {formatCount(testDrives[id])}
            </dd>
          </div>
        ))}
      </dl>
      {testDrives.upcoming > 0 ? (
        <p className="text-caption text-text-muted">
          {countLabel(testDrives.upcoming, "prueba", "pruebas")} todavía en
          horario hoy: no cuentan en la tasa.
        </p>
      ) : null}
    </MetricTile>
  );
}

function AttentionTile({ attention }: { attention: AttentionView }) {
  return (
    <MetricTile
      title="Requieren intervención"
      scope={<TodayTag />}
      action={<DrillLink href={QUEUE_HREF}>Ver cola</DrillLink>}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <MetricValue>{formatCount(attention.needsAttention)}</MetricValue>
          {attention.stale > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-danger-border bg-danger-soft px-2 py-0.5 text-caption text-danger">
              <AlertIcon aria-hidden="true" className="size-3.5" />
              {countLabel(attention.stale, "inactiva", "inactivas")}
            </span>
          ) : null}
        </div>
        <p className="text-caption text-text-muted">
          {attention.open === 0
            ? "Sin oportunidades abiertas."
            : `de ${countLabel(attention.open, "oportunidad abierta", "oportunidades abiertas")}`}
        </p>
      </div>
      {attention.open > 0 ? (
        <SegmentedBar
          segments={ATTENTION_ORDER.map((key) => ({
            key,
            label: `${ATTENTION_LABELS[key]}: ${formatCount(attention[key])}`,
            value: attention[key],
            fill: ATTENTION_FILL[key],
          }))}
        />
      ) : null}
      <dl className="flex flex-col gap-1.5">
        {ATTENTION_ORDER.map((key) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-3 text-label"
          >
            <dt className="flex items-center gap-1.5 text-text-secondary">
              <Swatch fill={ATTENTION_FILL[key]} />
              {ATTENTION_LABELS[key]}
            </dt>
            <dd className="font-semibold text-text-primary tabular-nums">
              {formatCount(attention[key])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-text-muted">
        Sin actividad del cliente: Enfriándose de 2 a 5 días, Inactivas más de 5
        días.
      </p>
    </MetricTile>
  );
}
