import { formatMoney, type Currency, type Money } from "@/domains/money";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { initialsOf } from "@/domains/opportunities/prospect";
import type { Stage } from "@/domains/opportunities/stages";
import { formatKm, vehicleName } from "@/domains/vehicles/stock";

import { discountFrom, type DiscountKind } from "./pricing";
import { quoteDiscountView, quoteNumberLabel } from "./presentation";
import type { QuoteStatus } from "./statuses";

/*
 * Presupuesto formal de una cotización (Hito 14, DEC-046 §3). Módulo puro y
 * determinista: arma, desde la fila que lee el servidor, el contenido del
 * documento que se entrega al cliente. Lo consumen los dos renderers:
 *
 *   QuoteDocumentSource ──► buildQuoteDocument() ──► QuoteDocument
 *                                                      ├─► vista previa HTML
 *                                                      │   (components/quotes/quote-document-sheet.tsx)
 *                                                      └─► PDF
 *                                                          (lib/quotes/pdf.ts)
 *
 * Los dos muestran exactamente los mismos textos, en el mismo orden: el
 * modelo ya llega formateado en es-PY y ningún renderer calcula montos,
 * fechas ni copy.
 *
 * - Las condiciones económicas son las de la fila, inmutables desde el alta
 *   (DEC-042 §2): precio de lista, descuento, total, moneda y validez. El
 *   total es el que guardó la base (el CHECK `quotes_total_price_check`
 *   rehace la cuenta), y la línea de descuento sale del mismo cálculo exacto
 *   (domains/quotes/pricing.ts), así que el desglose siempre cierra.
 * - El cliente es el contacto de la oportunidad (DEC-042 §1). El documento
 *   muestra su nombre y su ciudad, nunca su teléfono: la UI solo lo muestra
 *   enmascarado (`contacts.phone`) y el cliente no necesita el propio.
 * - Un dato opcional que falta (versión, kilometraje, ciudad) no se imprime:
 *   en un documento para el cliente, "Sin dato" no informa nada. Nada se
 *   inventa.
 * - Sin fotos ni imágenes del vehículo: no hay media real (DEC-025 §9) y una
 *   representación genérica no va en un presupuesto (CLAUDE.md §2).
 * - El espacio del logo lleva el monograma del concesionario (sus
 *   iniciales): la configuración no tiene logo todavía (DEC-038 §10).
 */

/** Lo que el servidor lee de una cotización para armar su presupuesto. */
export type QuoteDocumentSource = Readonly<{
  number: number;
  status: QuoteStatus;
  currency: Currency;
  /** Decimal canónico de dos decimales ("49900.00"). */
  listPrice: string;
  discountKind: DiscountKind;
  discountValue: string | null;
  totalPrice: string;
  /** Último día de validez, "AAAA-MM-DD" (Asunción, inclusive). */
  validUntil: string;
  /** Condiciones particulares, ya normalizadas (DEC-042 §4). */
  notes: string | null;
  /** Alta de la cotización: su fecha de emisión. */
  createdAt: Date;
  /** Etapa actual de su oportunidad (decide si se descarga). */
  opportunityStage: Stage;
  organizationName: string;
  customerName: string;
  customerCity: string | null;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleVersion: string | null;
  vehicleYear: number;
  vehicleKm: number | null;
}>;

/** Un dato rotulado ("Año", "2024"). */
export type QuoteDocumentField = Readonly<{ label: string; value: string }>;

/** Una línea del desglose de precio. */
export type QuoteDocumentLine = Readonly<{
  label: string;
  value: string;
  /** `discount`: un importe que se resta (se muestra en el tono de éxito). */
  tone: "default" | "discount";
}>;

export type QuoteDocument = Readonly<{
  /** "Presupuesto N.º 0007": título del documento y del PDF. */
  title: string;
  /** "N.º 0007". */
  numberLabel: string;
  /** "presupuesto-0007-ramon-benitez.pdf": solo ASCII. */
  fileName: string;
  issuer: Readonly<{
    /** Nombre del concesionario (`organizations.name`). */
    name: string;
    /** Iniciales para el espacio del logo ("AL"). */
    monogram: string;
  }>;
  /** Instante del alta: la fecha de creación de los metadatos del PDF. */
  issuedAt: Date;
  /** Día de emisión en Asunción, "AAAA-MM-DD". */
  issuedOn: string;
  /** "1 de noviembre de 2026". */
  issuedLabel: string;
  /** "AAAA-MM-DD". */
  validUntil: string;
  /** "8 de noviembre de 2026". */
  validUntilLabel: string;
  customer: Readonly<{
    name: string;
    fields: readonly QuoteDocumentField[];
  }>;
  vehicle: Readonly<{
    /** "Toyota Hilux". */
    name: string;
    /** Versión, año y kilometraje, los que se conocen. */
    fields: readonly QuoteDocumentField[];
  }>;
  pricing: Readonly<{
    currency: Currency;
    /** Precio de lista y, si tiene, el descuento. */
    lines: readonly QuoteDocumentLine[];
    /** "USD 46.157,50". */
    total: string;
  }>;
  /** Condiciones particulares que cargó el vendedor, una por renglón. */
  conditions: readonly string[];
  /** Términos generales, siempre los mismos (DEC-046 §3). */
  terms: readonly string[];
  /** "Automotores Lambaré · Presupuesto N.º 0007": pie de cada página. */
  footer: string;
}>;

/* ── Copy ───────────────────────────────────────────────────────────────── */

export const QUOTE_DOCUMENT_HEADING = "Presupuesto";

export const QUOTE_DOCUMENT_LABELS = {
  issued: "Fecha de emisión",
  validUntil: "Válido hasta",
  customer: "Cliente",
  vehicle: "Unidad cotizada",
  pricing: "Detalle de precio",
  concept: "Concepto",
  amount: "Importe",
  listPrice: "Precio de lista",
  discount: "Descuento",
  total: "Total",
  conditions: "Condiciones particulares",
  terms: "Términos",
  city: "Ciudad",
  version: "Versión",
  year: "Año",
  km: "Kilometraje",
} as const;

/** Nombre de cada moneda en los términos ("dólares estadounidenses (USD)"). */
export const QUOTE_CURRENCY_NAMES: Readonly<Record<Currency, string>> = {
  PYG: "guaraníes (Gs.)",
  USD: "dólares estadounidenses (USD)",
};

/* ── Fechas y nombre del archivo ────────────────────────────────────────── */

const LONG_DATE = new Intl.DateTimeFormat("es-PY", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día de calendario en letras: "2026-11-08" → "8 de noviembre de 2026". */
export function formatLongCalendarDate(value: string): string {
  const match = DATE.exec(value);
  if (!match) throw new Error(`invalid calendar date: ${value}`);
  return LONG_DATE.format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ),
  );
}

/** Largo máximo del nombre del cliente dentro del nombre del archivo. */
const FILE_NAME_SLUG_MAX = 40;

/** Texto en minúsculas ASCII separado por guiones ("Ramón Benítez" → "ramon-benitez"). */
function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, FILE_NAME_SLUG_MAX)
    .replace(/^-+|-+$/g, "");
}

/**
 * Nombre del archivo: "presupuesto-0007-ramon-benitez.pdf", solo ASCII para
 * que viaje igual en cualquier navegador y en WhatsApp. Sin nombre
 * aprovechable (solo emojis, por ejemplo), "presupuesto-0007.pdf".
 */
export function quoteDocumentFileName(
  number: number,
  customerName: string,
): string {
  const customer = slug(customerName);
  const base = `presupuesto-${String(number).padStart(4, "0")}`;
  return `${customer === "" ? base : `${base}-${customer}`}.pdf`;
}

/* ── Documento ──────────────────────────────────────────────────────────── */

function present(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Términos generales: validez, moneda y disponibilidad de la unidad. */
export function quoteTerms(
  validUntilLabel: string,
  currency: Currency,
): string[] {
  return [
    `Precios y condiciones válidos hasta el ${validUntilLabel} inclusive.`,
    `Importes expresados en ${QUOTE_CURRENCY_NAMES[currency]}.`,
    "Esta cotización no reserva la unidad: queda sujeta a disponibilidad al momento de su aceptación.",
  ];
}

/** Arma el presupuesto de una cotización. Puro: no lee el reloj. */
export function buildQuoteDocument(source: QuoteDocumentSource): QuoteDocument {
  const labels = QUOTE_DOCUMENT_LABELS;
  const numberLabel = quoteNumberLabel(source.number);
  const issuedOn = todayInAsuncion(source.createdAt);
  const validUntilLabel = formatLongCalendarDate(source.validUntil);
  const issuerName = source.organizationName.trim();

  const listPrice: Money = {
    amount: source.listPrice,
    currency: source.currency,
  };
  const discount = discountFrom(source.discountKind, source.discountValue);
  const discountView = quoteDiscountView(listPrice, discount);
  const lines: QuoteDocumentLine[] = [
    {
      label: labels.listPrice,
      value: formatMoney(listPrice),
      tone: "default",
    },
  ];
  if (discountView) {
    lines.push({
      // Un porcentaje se nombra; un monto fijo ya se lee en el importe.
      label:
        discount.kind === "percent"
          ? `${labels.discount} (${discountView.label})`
          : labels.discount,
      value: discountView.amountLabel,
      tone: "discount",
    });
  }

  const city = present(source.customerCity);
  const version = present(source.vehicleVersion);
  const vehicleFields: QuoteDocumentField[] = [];
  if (version) vehicleFields.push({ label: labels.version, value: version });
  vehicleFields.push({ label: labels.year, value: String(source.vehicleYear) });
  if (source.vehicleKm !== null) {
    vehicleFields.push({ label: labels.km, value: formatKm(source.vehicleKm) });
  }

  return {
    title: `${QUOTE_DOCUMENT_HEADING} ${numberLabel}`,
    numberLabel,
    fileName: quoteDocumentFileName(source.number, source.customerName),
    issuer: { name: issuerName, monogram: initialsOf(issuerName) },
    issuedAt: source.createdAt,
    issuedOn,
    issuedLabel: formatLongCalendarDate(issuedOn),
    validUntil: source.validUntil,
    validUntilLabel,
    customer: {
      name: source.customerName.trim(),
      fields: city ? [{ label: labels.city, value: city }] : [],
    },
    vehicle: {
      name: vehicleName({
        brand: source.vehicleBrand.trim(),
        model: source.vehicleModel.trim(),
      }),
      fields: vehicleFields,
    },
    pricing: {
      currency: source.currency,
      lines,
      total: formatMoney({
        amount: source.totalPrice,
        currency: source.currency,
      }),
    },
    conditions: (source.notes ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    terms: quoteTerms(validUntilLabel, source.currency),
    footer: `${issuerName} · ${QUOTE_DOCUMENT_HEADING} ${numberLabel}`,
  };
}
