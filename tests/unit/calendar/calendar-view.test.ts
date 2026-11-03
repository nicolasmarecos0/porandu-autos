import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CalendarView } from "@/components/calendar/calendar-view";
import type { CalendarAgenda } from "@/db/queries/calendar";
import {
  agendaCounts,
  agendaDays,
  type TestDriveRow,
} from "@/domains/calendar/agenda";
import {
  CALENDAR_TIME_ZONE,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";
import { calendarWeek } from "@/domains/calendar/week";

/*
 * Agenda ejecutiva de /calendar (Hito 13, DEC-045), renderizada en el
 * servidor sin DOM: el resumen por grupo con su medidor, la navegación de
 * semanas que conserva el día, la tira de días con el día en foco, la
 * agenda de ese día, la grilla horaria (eje, bloques ubicados por hora y
 * carriles), la forma y el texto de cada estado, la línea "ahora" y los
 * estados vacíos. Agendar y cambiar el estado se prueban en
 * tests/unit/calendar/requests.test.ts y tests/db/test-drives.test.ts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// Server Actions: renderizar nunca las llama.
vi.mock("@/lib/calendar/actions", () => ({
  scheduleTestDrive: vi.fn(),
  changeTestDriveStatus: vi.fn(),
}));

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(
  n: number,
  contactName: string,
  scheduledAt: string,
  status: TestDriveStatus,
  vehicleId: string,
  createdBy = USER,
): TestDriveRow {
  return {
    id: id(n),
    status,
    scheduledAt: new Date(scheduledAt),
    opportunityId: id(100 + n),
    contactName,
    vehicleId,
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleYear: 2022,
    createdBy,
  };
}

const ROWS: readonly TestDriveRow[] = [
  // Lunes 2: 09:30 realizada y 16:00 no asistió.
  row(1, "Ana Ríos", "2026-11-02T12:30:00Z", "completed", "v1"),
  row(2, "Elena Ortiz", "2026-11-02T19:00:00Z", "no_show", "v4"),
  // Miércoles 4 (hoy): 09:00 confirmada y 09:30 agendada con la misma
  // unidad (superpuestas), y 15:00 cancelada.
  row(3, "Bruno Gómez", "2026-11-04T12:00:00Z", "confirmed", "v2", OTHER),
  row(4, "Carla Benítez", "2026-11-04T12:30:00Z", "scheduled", "v2"),
  row(5, "Diego Núñez", "2026-11-04T18:00:00Z", "cancelled", "v3"),
  // Viernes 6: 11:00 agendada.
  row(6, "Fabián Rojas", "2026-11-06T14:00:00Z", "scheduled", "v1"),
];

function agenda(
  weekParam: string | undefined,
  rows: readonly TestDriveRow[] = ROWS,
): CalendarAgenda {
  const week = calendarWeek(weekParam, NOW, CALENDAR_TIME_ZONE);
  return {
    week,
    days: agendaDays(week, rows, USER, NOW),
    counts: agendaCounts(rows),
    total: rows.length,
    opportunities: [],
    vehicles: [],
    nowIso: NOW.toISOString(),
  };
}

function render(value: CalendarAgenda): string {
  return renderToStaticMarkup(
    createElement(CalendarView, { title: "Agenda", agenda: value }),
  );
}

/** Las etiquetas `<a>` que enlazan a `href`, sin importar el orden de los atributos. */
function anchors(html: string, href: string): string[] {
  return [...html.matchAll(/<a [^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(`href="${href}"`));
}

/** "miércoles, 4 de noviembre" según el ICU del runtime (DEC-041 §4). */
function longLabel(weekParam: string | undefined, date: string): string {
  const day = calendarWeek(weekParam, NOW, CALENDAR_TIME_ZONE).days.find(
    (candidate) => candidate.date === date,
  );
  if (!day) throw new Error(`no day ${date}`);
  return day.longLabel;
}

/** El HTML de la agenda del día en foco (debajo de `lg`). */
function focusAgenda(html: string, date: string): string {
  const start = html.indexOf(`<section aria-labelledby="focus-day-${date}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

/** El HTML de la columna de un día en la grilla (desde `lg`). */
function gridColumn(html: string, date: string): string {
  const start = html.indexOf(`<section aria-labelledby="grid-day-${date}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("agenda ejecutiva", () => {
  it("resume la semana por grupo, con por realizar desglosado y el medidor", () => {
    const html = render(agenda(undefined));

    expect(html).toContain("6 pruebas esta semana");
    expect(html).toContain(
      'aria-label="Distribución de la semana: 2 agendadas, 1 confirmada, 1 realizada, 1 no asistió, 1 cancelada"',
    );
    const groups = [
      ...html.matchAll(
        /<dt[^>]*>(?:(?!<\/dt>).)*?(Por realizar|Realizadas|No asistió|Canceladas)(?:(?!<\/dt>).)*<\/dt><dd[^>]*>(\d+)<\/dd>/g,
      ),
    ].map((match) => [match[1], match[2]]);
    expect(groups).toEqual([
      ["Por realizar", "3"],
      ["Realizadas", "1"],
      ["No asistió", "1"],
      ["Canceladas", "1"],
    ]);
    expect(html).toContain("(2 agendadas · 1 confirmada)");
  });

  it("anterior y siguiente conservan el día; Hoy marca la semana en curso", () => {
    const html = render(agenda(undefined));
    expect(anchors(html, "/calendar?w=2026-10-28")).toEqual([
      expect.stringContaining('aria-label="Semana anterior"'),
    ]);
    expect(anchors(html, "/calendar?w=2026-11-11")).toEqual([
      expect.stringContaining('aria-label="Semana siguiente"'),
    ]);
    // "Hoy" (semana en curso) y el día en foco de la tira.
    expect(anchors(html, "/calendar?w=2026-11-04")).toEqual([
      expect.stringContaining('aria-current="date"'),
      expect.stringContaining('aria-current="page"'),
    ]);
    expect(html).toContain("2 – 8 nov 2026");
  });

  it("la tira de días pone hoy en foco y cada día es un enlace con su cantidad", () => {
    const html = render(agenda(undefined));
    const strip = html.slice(
      html.indexOf('<nav aria-label="Días de la semana"'),
      html.indexOf(
        "</nav>",
        html.indexOf('<nav aria-label="Días de la semana"'),
      ),
    );
    const links = [...strip.matchAll(/href="\/calendar\?w=([\d-]+)"/g)].map(
      (match) => match[1],
    );
    expect(links).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(strip.match(/aria-current="page"/g)).toHaveLength(1);
    expect(anchors(strip, "/calendar?w=2026-11-04")).toEqual([
      expect.stringContaining('aria-current="page"'),
    ]);
    expect(strip).toContain(
      `${longLabel(undefined, "2026-11-04")}, hoy: 3 pruebas`,
    );
    expect(strip).toContain(`${longLabel(undefined, "2026-11-02")}: 2 pruebas`);
    expect(strip).toContain(`${longLabel(undefined, "2026-11-03")}: 0 pruebas`);
  });

  it("la agenda del día en foco muestra solo ese día, por hora, con tarjetas completas", () => {
    const day = focusAgenda(render(agenda(undefined)), "2026-11-04");

    expect(day).toContain(`>${longLabel(undefined, "2026-11-04")}</h2>`);
    expect(day).toContain("Hoy · 3 pruebas");
    expect(day.indexOf("Bruno Gómez")).toBeLessThan(
      day.indexOf("Carla Benítez"),
    );
    expect(day.indexOf("Carla Benítez")).toBeLessThan(
      day.indexOf("Diego Núñez"),
    );
    for (const name of ["Ana Ríos", "Elena Ortiz", "Fabián Rojas"]) {
      expect(day).not.toContain(name);
    }
    expect(day).toContain(`href="/opportunities/${id(103)}"`);
    expect(day.match(/Unidad superpuesta/g)).toHaveLength(2);
    expect(day).toContain("Agendó: Otro miembro");
    expect(day).toContain("Agendó: Vos");
    expect(day).toContain(">Confirmada<");
    expect(day).toContain(">Agendada<");
    expect(day).toContain(">Cancelada<");
  });

  it("otro día de la semana en foco: sus pruebas y los saltos desde ese día", () => {
    const html = render(agenda("2026-11-06"));
    const day = focusAgenda(html, "2026-11-06");
    expect(day).toContain(`>${longLabel("2026-11-06", "2026-11-06")}</h2>`);
    expect(day).not.toContain("Hoy ·");
    expect(day).toContain("Fabián Rojas");
    expect(day).not.toContain("Bruno Gómez");
    expect(anchors(html, "/calendar?w=2026-11-06")).toEqual([
      expect.stringContaining('aria-current="page"'),
    ]);
    expect(anchors(html, "/calendar?w=2026-10-30")).toEqual([
      expect.stringContaining('aria-label="Semana anterior"'),
    ]);
    expect(anchors(html, "/calendar?w=2026-11-13")).toEqual([
      expect.stringContaining('aria-label="Semana siguiente"'),
    ]);

    const empty = focusAgenda(render(agenda("2026-11-03")), "2026-11-03");
    expect(empty).toContain("0 pruebas");
    expect(empty).toContain("Sin pruebas este día.");
  });

  it("la grilla ubica cada prueba por su hora en la columna de su día", () => {
    const html = render(agenda(undefined));

    const hours = [
      ...html.matchAll(/tabular-nums[^"]*"[^>]*>(\d{2}:00)<\/span>/g),
    ].map((match) => match[1]);
    expect(hours).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
    ]);

    // Lunes 09:30: a 90 de 720 minutos del inicio, una hora de alto.
    const monday = gridColumn(html, "2026-11-02");
    expect(monday).toContain(
      'style="top:calc(12.5% + 1px);height:calc(8.3333% - 2px);left:calc(0% + 2px);width:calc(100% - 4px)"',
    );
    expect(monday).toContain("Ana Ríos");
    expect(monday).not.toContain("Bruno Gómez");
    expect(gridColumn(html, "2026-11-03")).not.toContain("<li");

    // Miércoles 09:00 y 09:30 se pisan: dos carriles.
    const wednesday = gridColumn(html, "2026-11-04");
    expect(wednesday).toContain(
      `${longLabel(undefined, "2026-11-04")}, hoy: 3 pruebas`,
    );
    expect(wednesday).toContain(
      'style="top:calc(8.3333% + 1px);height:calc(8.3333% - 2px);left:calc(0% + 2px);width:calc(50% - 4px)"',
    );
    expect(wednesday).toContain(
      'style="top:calc(12.5% + 1px);height:calc(8.3333% - 2px);left:calc(50% + 2px);width:calc(50% - 4px)"',
    );
    expect(wednesday.match(/\. Unidad superpuesta/g)).toHaveLength(2);
    expect(wednesday.match(/ring-1 ring-warning/g)).toHaveLength(2);
    expect(wednesday).toContain('aria-haspopup="dialog"');
  });

  it("cada bloque dice hora y estado en texto, con su forma, y la cancelada se tacha", () => {
    const html = render(agenda(undefined));
    const monday = gridColumn(html, "2026-11-02");
    expect(monday).toMatch(
      /<time dateTime="2026-11-02T12:30:00.000Z"[^>]*>09:30<\/time>/,
    );
    expect(monday).toContain("Realizada");
    expect(monday).toContain("No asistió");
    expect(monday).toContain("bg-success-soft");
    expect(monday).toContain("bg-warning-soft");

    const wednesday = gridColumn(html, "2026-11-04");
    expect(wednesday).toMatch(
      /<time dateTime="2026-11-04T18:00:00.000Z" class="[^"]*line-through[^"]*">15:00<\/time>/,
    );
    expect(wednesday).toContain("border-dashed");
    // Agendada: anillo; confirmada: punto lleno.
    expect(wednesday).toContain("border-[1.5px] border-current");
    expect(wednesday).toContain("rounded-full bg-current");
  });

  it("la línea ahora arranca en la columna de hoy, a la hora del request", () => {
    const html = render(agenda(undefined));
    expect(html).toMatch(
      /data-now-indicator=""[^>]*style="top:16.6667%;left:28.5714%;width:14.2857%"/,
    );
    // En otra semana no hay línea.
    expect(render(agenda("2026-11-12"))).not.toContain("data-now-indicator");
  });

  it("una semana sin pruebas: estado vacío, sin resumen y la grilla igual", () => {
    const html = render(agenda(undefined, []));
    expect(html).toContain("0 pruebas esta semana");
    expect(html).not.toContain("Distribución de la semana");
    expect(html.match(/No hay pruebas de manejo esta semana\./g)).toHaveLength(
      2,
    );
    expect(html).toContain("08:00");
    expect(html).not.toContain('<li class="absolute"');
  });
});

describe("atajo del catálogo: Agendar prueba con una unidad (propuesta DEC-049)", () => {
  const withOptions: CalendarAgenda = {
    ...agenda(undefined),
    opportunities: [{ id: id(201), contactName: "Ana Ríos" }],
    vehicles: [{ id: id(301), label: "Toyota Hilux 2025" }],
  };

  /** El botón "Agendar prueba" (disparador del drawer). */
  function scheduleTrigger(scheduleVehicleId?: string): string {
    const html = renderToStaticMarkup(
      createElement(CalendarView, {
        title: "Agenda",
        agenda: withOptions,
        scheduleVehicleId,
      }),
    );
    const tag = [...html.matchAll(/<button\b[^>]*>/g)]
      .map((match) => match[0])
      .find((candidate) => candidate.includes('aria-haspopup="dialog"'));
    if (!tag) throw new Error("missing schedule trigger");
    return tag;
  }

  it("una unidad que se puede probar llega con el alta abierta", () => {
    expect(scheduleTrigger(id(301))).toContain('data-state="open"');
  });

  it("sin atajo, o con una unidad que no es opción, el alta arranca cerrada", () => {
    expect(scheduleTrigger()).toContain('data-state="closed"');
    expect(scheduleTrigger(id(999))).toContain('data-state="closed"');
    expect(scheduleTrigger("no-es-un-id")).toContain('data-state="closed"');
  });
});
