import "server-only";

import {
  PDFDocument,
  rgb,
  StandardFonts,
  type Color,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import {
  QUOTE_DOCUMENT_HEADING,
  QUOTE_DOCUMENT_LABELS,
  type QuoteDocument,
  type QuoteDocumentField,
} from "@/domains/quotes/document";
import { toPdfText, truncateText, wrapText } from "@/lib/pdf/text";

/*
 * Generador del presupuesto en PDF (Hito 14, DEC-046 §4). Es el único
 * módulo que conoce pdf-lib (ESLint lo impide en cualquier otro): la
 * librería queda detrás de este servicio interno y el dominio no la conoce
 * (CLAUDE.md §3). Solo corre en el servidor, en GET /api/quotes/[quoteId]/pdf.
 *
 *   QuoteDocument (domains/quotes/document.ts, ya formateado en es-PY)
 *     → A4 vertical, Helvetica (fuentes estándar, sin embeber)
 *     → texto vectorial: se selecciona, se busca y se imprime nítido
 *     → Uint8Array (unos pocos KB, en milisegundos)
 *
 *   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ (banda de marca)
 *   [AL] Automotores Lambaré                       PRESUPUESTO
 *                                                    N.º 0007
 *                             Fecha de emisión 1 de noviembre de 2026
 *                                 Válido hasta 8 de noviembre de 2026
 *   ───────────────────────────────────────────────────────────────
 *   ┌ CLIENTE ──────────────────┐  ┌ UNIDAD COTIZADA ───────────┐
 *   │ Ramón Benítez             │  │ Toyota Hilux               │
 *   │ Ciudad  Asunción          │  │ Versión  SRV 2.8 4x4 AT    │
 *   └───────────────────────────┘  │ Año  2024 · Kilometraje …  │
 *                                  └────────────────────────────┘
 *   DETALLE DE PRECIO
 *   ┌ CONCEPTO ─────────────────────────────────── IMPORTE (USD) ┐
 *   │ Precio de lista                                 USD 49.900 │
 *   │ Descuento (7,5 %)                           – USD 3.742,50 │
 *   │ Total                                        USD 46.157,50 │
 *   └────────────────────────────────────────────────────────────┘
 *   CONDICIONES PARTICULARES · TÉRMINOS
 *   ───────────────────────────────────────────────────────────────
 *   Automotores Lambaré · Presupuesto N.º 0007          Página 1 de 1
 *
 * - Determinista: el mismo documento da los mismos bytes. Las fechas de los
 *   metadatos son las del alta de la cotización, nunca el reloj del
 *   servidor, y pdf-lib no agrega identificadores al azar.
 * - Nunca falla por un carácter: todo texto pasa por toPdfText()
 *   (lib/pdf/text.ts), que lo deja en lo que Helvetica sabe dibujar.
 * - Si el contenido no entra en una página (condiciones largas, nombres muy
 *   largos), sigue en otra con la misma banda y el mismo pie numerado.
 */

/*
 * Colores: los mismos valores de components/ui/tokens.css (DEC-013). pdf-lib
 * no lee CSS, así que se espejan acá y un test compara cada uno con su
 * token: cambiar un color es cambiar el token.
 */
export const PDF_COLOR_TOKENS = {
  brand: { token: "--color-brand", hex: "#376b89" },
  brandStrong: { token: "--color-brand-strong", hex: "#244a60" },
  brandSoft: { token: "--color-brand-soft", hex: "#e7eff4" },
  textPrimary: { token: "--color-text-primary", hex: "#16212b" },
  textSecondary: { token: "--color-text-secondary", hex: "#3e4a56" },
  textMuted: { token: "--color-text-muted", hex: "#5c6874" },
  textInverse: { token: "--color-text-inverse", hex: "#ffffff" },
  surface2: { token: "--color-surface-2", hex: "#f7f9fa" },
  surfaceInverse: { token: "--color-surface-inverse", hex: "#1d2830" },
  borderSubtle: { token: "--color-border-subtle", hex: "#e4e9ed" },
  borderDefault: { token: "--color-border-default", hex: "#d6dde3" },
  success: { token: "--color-success", hex: "#1d7348" },
} as const;

type ColorName = keyof typeof PDF_COLOR_TOKENS;

function hexColor(hex: string): Color {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

const COLORS = Object.fromEntries(
  Object.entries(PDF_COLOR_TOKENS).map(([name, { hex }]) => [
    name,
    hexColor(hex),
  ]),
) as Readonly<Record<ColorName, Color>>;

/* ── Página (puntos PDF: 1/72 de pulgada) ───────────────────────────────── */

/** A4 vertical. */
export const PDF_PAGE_SIZE = { width: 595.28, height: 841.89 } as const;

const MARGIN = 48;
const CONTENT_WIDTH = PDF_PAGE_SIZE.width - MARGIN * 2;
const RIGHT = PDF_PAGE_SIZE.width - MARGIN;
const BAND_HEIGHT = 6;
/** Borde superior del contenido, debajo de la banda de marca. */
const CONTENT_TOP = PDF_PAGE_SIZE.height - BAND_HEIGHT - 42;
/** El contenido no baja de acá: debajo va el pie. */
const CONTENT_BOTTOM = 78;
const FOOTER_RULE_Y = 56;
const FOOTER_TEXT_Y = 40;
const SECTION_GAP = 22;

/* ── Escritura ──────────────────────────────────────────────────────────── */

type TextStyle = Readonly<{ font: PDFFont; size: number; color: Color }>;

type Fonts = Readonly<{ regular: PDFFont; bold: PDFFont }>;

/** Estado del armado: la página actual y el borde superior libre (`y`). */
type Layout = {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly clean: (text: string) => string;
  readonly pages: PDFPage[];
  page: PDFPage;
  y: number;
};

function measure(style: TextStyle) {
  return (text: string) => style.font.widthOfTextAtSize(text, style.size);
}

/** Alto de las mayúsculas: centra un texto en un alto dado. */
function capHeight(style: TextStyle): number {
  return style.font.heightAtSize(style.size, { descender: false });
}

/** Dibuja un texto ya limpio con su línea base en `y`. */
function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  if (text === "") return;
  page.drawText(text, {
    x,
    y,
    font: style.font,
    size: style.size,
    color: style.color,
  });
}

/** Igual que draw(), alineado a la derecha en `right`. */
function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  style: TextStyle,
): void {
  draw(page, text, right - measure(style)(text), y, style);
}

function addPage(layout: Layout): void {
  const page = layout.doc.addPage([PDF_PAGE_SIZE.width, PDF_PAGE_SIZE.height]);
  page.drawRectangle({
    x: 0,
    y: PDF_PAGE_SIZE.height - BAND_HEIGHT,
    width: PDF_PAGE_SIZE.width,
    height: BAND_HEIGHT,
    color: COLORS.brand,
  });
  layout.pages.push(page);
  layout.page = page;
  layout.y = CONTENT_TOP;
}

/** Garantiza `height` puntos libres; si no entran, sigue en otra página. */
function ensure(layout: Layout, height: number): void {
  if (layout.y - height < CONTENT_BOTTOM) addPage(layout);
}

/** Rectángulo de esquinas redondeadas con su borde superior en `top`. */
function roundedRect(
  page: PDFPage,
  x: number,
  top: number,
  width: number,
  height: number,
  radius: number,
  options: Readonly<{ color?: Color; borderColor?: Color }>,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  // SVG: el eje y crece hacia abajo desde (x, top).
  const path = [
    `M ${r} 0`,
    `H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join(" ");
  page.drawSvgPath(path, {
    x,
    y: top,
    color: options.color,
    borderColor: options.borderColor,
    borderWidth: options.borderColor ? 0.75 : 0,
  });
}

function rule(layout: Layout, color: Color = COLORS.borderDefault): void {
  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y },
    end: { x: RIGHT, y: layout.y },
    thickness: 0.75,
    color,
  });
}

/* ── Estilos ────────────────────────────────────────────────────────────── */

function styles(fonts: Fonts) {
  return {
    monogram: { font: fonts.bold, size: 16, color: COLORS.textInverse },
    issuer: { font: fonts.bold, size: 13, color: COLORS.textPrimary },
    heading: { font: fonts.bold, size: 9, color: COLORS.brand },
    number: { font: fonts.bold, size: 20, color: COLORS.textPrimary },
    metaLabel: { font: fonts.regular, size: 8.5, color: COLORS.textMuted },
    metaValue: { font: fonts.bold, size: 8.5, color: COLORS.textPrimary },
    overline: { font: fonts.bold, size: 7.5, color: COLORS.textMuted },
    partyName: { font: fonts.bold, size: 12, color: COLORS.textPrimary },
    fieldLabel: { font: fonts.regular, size: 8.5, color: COLORS.textMuted },
    fieldValue: { font: fonts.regular, size: 9.5, color: COLORS.textSecondary },
    tableHead: { font: fonts.bold, size: 7.5, color: COLORS.textInverse },
    rowLabel: { font: fonts.regular, size: 10, color: COLORS.textSecondary },
    rowValue: { font: fonts.regular, size: 10, color: COLORS.textPrimary },
    discount: { font: fonts.regular, size: 10, color: COLORS.success },
    totalLabel: { font: fonts.bold, size: 11, color: COLORS.textPrimary },
    totalValue: { font: fonts.bold, size: 15, color: COLORS.brandStrong },
    paragraph: { font: fonts.regular, size: 10, color: COLORS.textSecondary },
    term: { font: fonts.regular, size: 9, color: COLORS.textSecondary },
    termIndex: { font: fonts.regular, size: 9, color: COLORS.textMuted },
    footer: { font: fonts.regular, size: 8, color: COLORS.textMuted },
  } as const satisfies Record<string, TextStyle>;
}

type Styles = ReturnType<typeof styles>;

/** Rótulo de sección en mayúsculas ("DETALLE DE PRECIO"), ya limpio. */
function overline(text: string, layout: Layout): string {
  return layout.clean(text.toLocaleUpperCase("es-PY"));
}

/* ── Encabezado: logo, emisor, número y fechas ──────────────────────────── */

const LOGO_SIZE = 46;

function drawHeader(layout: Layout, s: Styles, doc: QuoteDocument): void {
  const { page, clean } = layout;
  const top = layout.y;

  // Espacio del logo: el monograma del concesionario (DEC-038 §10).
  roundedRect(page, MARGIN, top, LOGO_SIZE, LOGO_SIZE, 8, {
    color: COLORS.brand,
  });
  const monogram = clean(doc.issuer.monogram);
  draw(
    page,
    monogram,
    MARGIN + (LOGO_SIZE - measure(s.monogram)(monogram)) / 2,
    top - LOGO_SIZE / 2 - capHeight(s.monogram) / 2,
    s.monogram,
  );

  // Derecha: "PRESUPUESTO", número y fechas (se mide antes, para el emisor).
  const meta: readonly QuoteDocumentField[] = [
    { label: QUOTE_DOCUMENT_LABELS.issued, value: doc.issuedLabel },
    { label: QUOTE_DOCUMENT_LABELS.validUntil, value: doc.validUntilLabel },
  ].map(({ label, value }) => ({ label: clean(label), value: clean(value) }));
  const heading = overline(QUOTE_DOCUMENT_HEADING, layout);
  const number = clean(doc.numberLabel);
  const rightWidth = Math.max(
    measure(s.heading)(heading),
    measure(s.number)(number),
    ...meta.map(
      ({ label, value }) =>
        measure(s.metaLabel)(label) + 6 + measure(s.metaValue)(value),
    ),
  );

  // Emisor, a la derecha del logo, sin invadir el bloque de la derecha.
  const nameX = MARGIN + LOGO_SIZE + 12;
  const nameWidth = Math.min(
    260,
    Math.max(120, RIGHT - rightWidth - 24 - nameX),
  );
  const nameLines = wrapText(
    clean(doc.issuer.name),
    nameWidth,
    measure(s.issuer),
  );
  const nameLineHeight = 16;
  const nameBlock = nameLines.length * nameLineHeight;
  // Un renglón se centra con el logo; varios arrancan arriba.
  let nameBaseline =
    nameLines.length <= 1
      ? top - LOGO_SIZE / 2 - capHeight(s.issuer) / 2
      : top - capHeight(s.issuer) - 2;
  for (const line of nameLines) {
    draw(page, line, nameX, nameBaseline, s.issuer);
    nameBaseline -= nameLineHeight;
  }
  const left = Math.max(LOGO_SIZE, nameBlock);

  let baseline = top - capHeight(s.heading);
  drawRight(page, heading, RIGHT, baseline, s.heading);
  baseline -= 24;
  drawRight(page, number, RIGHT, baseline, s.number);
  baseline -= 8;
  for (const { label, value } of meta) {
    baseline -= 13;
    const valueWidth = measure(s.metaValue)(value);
    drawRight(page, value, RIGHT, baseline, s.metaValue);
    drawRight(page, label, RIGHT - valueWidth - 6, baseline, s.metaLabel);
  }
  const right = top - baseline + 4;

  layout.y = top - Math.max(left, right) - 18;
  rule(layout);
  layout.y -= SECTION_GAP;
}

/* ── Cliente y unidad ───────────────────────────────────────────────────── */

const BOX_PADDING = 12;
const COLUMN_GAP = 16;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;

type PartyBox = Readonly<{
  overline: string;
  nameLines: readonly string[];
  fields: readonly Readonly<{ label: string; lines: readonly string[] }>[];
  labelWidth: number;
  height: number;
}>;

const PARTY = {
  overline: 10,
  name: 15,
  field: 13,
  gap: 6,
} as const;

function partyBox(
  layout: Layout,
  s: Styles,
  title: string,
  name: string,
  fields: readonly QuoteDocumentField[],
): PartyBox {
  const inner = COLUMN_WIDTH - BOX_PADDING * 2;
  const nameLines = wrapText(layout.clean(name), inner, measure(s.partyName));
  const labels = fields.map((field) => layout.clean(field.label));
  const labelWidth = labels.reduce(
    (widest, label) => Math.max(widest, measure(s.fieldLabel)(label)),
    0,
  );
  const valueWidth = inner - labelWidth - 8;
  const wrapped = fields.map((field, index) => ({
    label: labels[index]!,
    lines: wrapText(
      layout.clean(field.value),
      valueWidth,
      measure(s.fieldValue),
    ),
  }));
  const fieldLines = wrapped.reduce((total, f) => total + f.lines.length, 0);
  const height =
    BOX_PADDING +
    PARTY.overline +
    PARTY.gap +
    nameLines.length * PARTY.name +
    (fieldLines > 0 ? PARTY.gap / 2 + fieldLines * PARTY.field : 0) +
    BOX_PADDING;
  return {
    overline: overline(title, layout),
    nameLines,
    fields: wrapped,
    labelWidth,
    height,
  };
}

function drawPartyBox(
  layout: Layout,
  s: Styles,
  box: PartyBox,
  x: number,
  top: number,
  height: number,
): void {
  const { page } = layout;
  roundedRect(page, x, top, COLUMN_WIDTH, height, 6, {
    color: COLORS.surface2,
    borderColor: COLORS.borderSubtle,
  });
  const textX = x + BOX_PADDING;
  const valueX = textX + box.labelWidth + 8;
  // `y` es el borde superior del próximo renglón; cada texto apoya su línea
  // base a la altura de sus mayúsculas debajo de ese borde.
  let y = top - BOX_PADDING;
  draw(page, box.overline, textX, y - capHeight(s.overline), s.overline);
  y -= PARTY.overline + PARTY.gap;
  for (const line of box.nameLines) {
    draw(page, line, textX, y - capHeight(s.partyName), s.partyName);
    y -= PARTY.name;
  }
  if (box.fields.length > 0) y -= PARTY.gap / 2;
  for (const field of box.fields) {
    field.lines.forEach((line, index) => {
      const baseline = y - capHeight(s.fieldValue);
      if (index === 0) draw(page, field.label, textX, baseline, s.fieldLabel);
      draw(page, line, valueX, baseline, s.fieldValue);
      y -= PARTY.field;
    });
  }
}

function drawParties(layout: Layout, s: Styles, doc: QuoteDocument): void {
  const customer = partyBox(
    layout,
    s,
    QUOTE_DOCUMENT_LABELS.customer,
    doc.customer.name,
    doc.customer.fields,
  );
  const vehicle = partyBox(
    layout,
    s,
    QUOTE_DOCUMENT_LABELS.vehicle,
    doc.vehicle.name,
    doc.vehicle.fields,
  );
  const height = Math.max(customer.height, vehicle.height);
  ensure(layout, height);
  drawPartyBox(layout, s, customer, MARGIN, layout.y, height);
  drawPartyBox(
    layout,
    s,
    vehicle,
    MARGIN + COLUMN_WIDTH + COLUMN_GAP,
    layout.y,
    height,
  );
  layout.y -= height + SECTION_GAP;
}

/* ── Detalle de precio ──────────────────────────────────────────────────── */

const TABLE = {
  overline: 16,
  head: 22,
  row: 26,
  total: 36,
  padding: 12,
} as const;

function drawPricing(layout: Layout, s: Styles, doc: QuoteDocument): void {
  const { clean } = layout;
  const lines = doc.pricing.lines;
  const height =
    TABLE.overline + TABLE.head + lines.length * TABLE.row + TABLE.total;
  ensure(layout, height);
  const { page } = layout;

  let top = layout.y;
  draw(
    page,
    overline(QUOTE_DOCUMENT_LABELS.pricing, layout),
    MARGIN,
    top - capHeight(s.overline),
    s.overline,
  );
  top -= TABLE.overline;
  const tableTop = top;

  // Encabezado en grafito, como las tablas de la UI (DEC-013).
  page.drawRectangle({
    x: MARGIN,
    y: top - TABLE.head,
    width: CONTENT_WIDTH,
    height: TABLE.head,
    color: COLORS.surfaceInverse,
  });
  const headBaseline = top - TABLE.head / 2 - capHeight(s.tableHead) / 2;
  draw(
    page,
    overline(QUOTE_DOCUMENT_LABELS.concept, layout),
    MARGIN + TABLE.padding,
    headBaseline,
    s.tableHead,
  );
  // Cada importe ya lleva su moneda ("USD", "Gs.") y los términos la nombran.
  drawRight(
    page,
    overline(QUOTE_DOCUMENT_LABELS.amount, layout),
    RIGHT - TABLE.padding,
    headBaseline,
    s.tableHead,
  );
  top -= TABLE.head;

  const valueWidth = CONTENT_WIDTH / 2 - TABLE.padding;
  for (const line of lines) {
    const baseline = top - TABLE.row / 2 - capHeight(s.rowLabel) / 2;
    const valueStyle = line.tone === "discount" ? s.discount : s.rowValue;
    draw(
      page,
      truncateText(clean(line.label), valueWidth, measure(s.rowLabel)),
      MARGIN + TABLE.padding,
      baseline,
      s.rowLabel,
    );
    drawRight(
      page,
      clean(line.value),
      RIGHT - TABLE.padding,
      baseline,
      valueStyle,
    );
    top -= TABLE.row;
    page.drawLine({
      start: { x: MARGIN, y: top },
      end: { x: RIGHT, y: top },
      thickness: 0.75,
      color: COLORS.borderSubtle,
    });
  }

  page.drawRectangle({
    x: MARGIN,
    y: top - TABLE.total,
    width: CONTENT_WIDTH,
    height: TABLE.total,
    color: COLORS.brandSoft,
  });
  const totalBaseline = top - TABLE.total / 2 - capHeight(s.totalValue) / 2;
  draw(
    page,
    clean(QUOTE_DOCUMENT_LABELS.total),
    MARGIN + TABLE.padding,
    totalBaseline,
    s.totalLabel,
  );
  drawRight(
    page,
    clean(doc.pricing.total),
    RIGHT - TABLE.padding,
    totalBaseline,
    s.totalValue,
  );
  top -= TABLE.total;

  // Contorno de la tabla, por encima de los rellenos.
  page.drawRectangle({
    x: MARGIN,
    y: top,
    width: CONTENT_WIDTH,
    height: tableTop - top,
    borderColor: COLORS.borderDefault,
    borderWidth: 0.75,
  });
  layout.y = top - SECTION_GAP;
}

/* ── Condiciones y términos ─────────────────────────────────────────────── */

function drawSectionTitle(layout: Layout, s: Styles, title: string): void {
  // El rótulo nunca queda solo al pie: pide lugar para un renglón más.
  ensure(layout, TABLE.overline + 14);
  draw(
    layout.page,
    overline(title, layout),
    MARGIN,
    layout.y - capHeight(s.overline),
    s.overline,
  );
  layout.y -= TABLE.overline;
}

function drawParagraphs(
  layout: Layout,
  paragraphs: readonly string[],
  style: TextStyle,
  lineHeight: number,
  options: Readonly<{ numbered: boolean; indexStyle?: TextStyle }>,
): void {
  const indent = options.numbered ? 14 : 0;
  paragraphs.forEach((paragraph, index) => {
    const lines = wrapText(
      layout.clean(paragraph),
      CONTENT_WIDTH - indent,
      measure(style),
    );
    lines.forEach((line, lineIndex) => {
      ensure(layout, lineHeight);
      const baseline = layout.y - capHeight(style);
      if (options.numbered && lineIndex === 0 && options.indexStyle) {
        draw(
          layout.page,
          `${index + 1}.`,
          MARGIN,
          baseline,
          options.indexStyle,
        );
      }
      draw(layout.page, line, MARGIN + indent, baseline, style);
      layout.y -= lineHeight;
    });
    layout.y -= 4;
  });
}

function drawConditions(layout: Layout, s: Styles, doc: QuoteDocument): void {
  if (doc.conditions.length === 0) return;
  drawSectionTitle(layout, s, QUOTE_DOCUMENT_LABELS.conditions);
  drawParagraphs(layout, doc.conditions, s.paragraph, 14, { numbered: false });
  layout.y -= SECTION_GAP - 4;
}

function drawTerms(layout: Layout, s: Styles, doc: QuoteDocument): void {
  drawSectionTitle(layout, s, QUOTE_DOCUMENT_LABELS.terms);
  drawParagraphs(layout, doc.terms, s.term, 12.5, {
    numbered: true,
    indexStyle: s.termIndex,
  });
}

/* ── Pie numerado ───────────────────────────────────────────────────────── */

function drawFooters(layout: Layout, s: Styles, doc: QuoteDocument): void {
  const total = layout.pages.length;
  const footer = layout.clean(doc.footer);
  layout.pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_RULE_Y },
      end: { x: RIGHT, y: FOOTER_RULE_Y },
      thickness: 0.75,
      color: COLORS.borderSubtle,
    });
    const pageLabel = `Página ${index + 1} de ${total}`;
    const pageWidth = measure(s.footer)(pageLabel);
    drawRight(page, layout.clean(pageLabel), RIGHT, FOOTER_TEXT_Y, s.footer);
    draw(
      page,
      truncateText(footer, CONTENT_WIDTH - pageWidth - 24, measure(s.footer)),
      MARGIN,
      FOOTER_TEXT_Y,
      s.footer,
    );
  });
}

/* ── Documento ──────────────────────────────────────────────────────────── */

/** Productor de los metadatos del PDF. */
export const PDF_PRODUCER = "Porandú Autos";

/** Genera el PDF del presupuesto. No lee el reloj ni la base. */
export async function renderQuotePdf(
  document: QuoteDocument,
): Promise<Uint8Array> {
  // Sin metadatos automáticos: pdf-lib pondría la hora del servidor.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  // Helvetica y Helvetica Bold comparten la codificación (WinAnsi).
  const encodable = new Set(fonts.regular.getCharacterSet());
  const layout: Layout = {
    doc,
    fonts,
    clean: (text) => toPdfText(text, (codePoint) => encodable.has(codePoint)),
    pages: [],
    // addPage() los fija en la primera página.
    page: undefined as unknown as PDFPage,
    y: CONTENT_TOP,
  };
  const s = styles(fonts);

  addPage(layout);
  drawHeader(layout, s, document);
  drawParties(layout, s, document);
  drawPricing(layout, s, document);
  drawConditions(layout, s, document);
  drawTerms(layout, s, document);
  drawFooters(layout, s, document);

  doc.setTitle(document.title, { showInWindowTitleBar: true });
  doc.setAuthor(document.issuer.name);
  doc.setSubject(`${document.title} · ${document.vehicle.name}`);
  doc.setCreator(PDF_PRODUCER);
  doc.setProducer(PDF_PRODUCER);
  doc.setLanguage("es-PY");
  doc.setCreationDate(document.issuedAt);
  doc.setModificationDate(document.issuedAt);
  return doc.save();
}
