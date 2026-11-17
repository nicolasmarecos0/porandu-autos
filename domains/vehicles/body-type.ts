import type { BodyType } from "./types";

/*
 * Carrocería por modelo (DEC-058 §4): el inventario y la demanda no guardan
 * la carrocería, así que la representación genérica de un vehículo se elige
 * por su modelo con una tabla cerrada de los modelos del mercado paraguayo.
 * Pura y apta para el navegador.
 *
 * - Un modelo que la tabla no conoce es null: la UI no muestra una
 *   representación antes que inventar una carrocería.
 * - Solo decide qué ilustración genérica mostrar ("Representación"): no es
 *   un dato del vehículo, no se persiste y no participa de Match ni de los
 *   scores.
 */

/** Modelos conocidos por carrocería, en minúsculas y sin tildes. */
const MODELS_BY_BODY: Readonly<Record<BodyType, readonly string[]>> = {
  pickup: [
    "hilux",
    "frontier",
    "amarok",
    "ranger",
    "s10",
    "s-10",
    "l200",
    "l 200",
    "triton",
    "navara",
    "np300",
    "d-max",
    "dmax",
    "strada",
    "saveiro",
    "toro",
    "oroch",
    "montana",
    "maverick",
    "tacoma",
    "tundra",
    "f-150",
    "f150",
    "ram",
    "bt-50",
    "bt50",
    "alaskan",
    "poer",
    "rampage",
    "titano",
    "t60",
  ],
  suv: [
    "corolla cross",
    "yaris cross",
    "sportage",
    "tucson",
    "kicks",
    "rav4",
    "rav 4",
    "sw4",
    "fortuner",
    "land cruiser",
    "prado",
    "rush",
    "raize",
    "c-hr",
    "chr",
    "creta",
    "santa fe",
    "kona",
    "venue",
    "seltos",
    "sonet",
    "sorento",
    "tiguan",
    "t-cross",
    "taos",
    "nivus",
    "compass",
    "renegade",
    "commander",
    "duster",
    "captur",
    "koleos",
    "tracker",
    "trailblazer",
    "equinox",
    "cr-v",
    "crv",
    "hr-v",
    "hrv",
    "wr-v",
    "ecosport",
    "territory",
    "everest",
    "bronco",
    "x-trail",
    "xtrail",
    "qashqai",
    "pathfinder",
    "outlander",
    "asx",
    "eclipse cross",
    "cx-3",
    "cx-30",
    "cx-5",
    "cx5",
    "tiggo",
    "h6",
    "jolion",
    "2008",
    "3008",
    "5008",
    "pulse",
    "fastback",
    "vitara",
    "grand vitara",
    "jimny",
    "s-cross",
    "forester",
    "outback",
    "crosstrek",
  ],
  sedan: [
    "corolla",
    "camry",
    "yaris sedan",
    "sentra",
    "versa",
    "altima",
    "civic",
    "city",
    "accord",
    "onix plus",
    "prisma",
    "cruze",
    "virtus",
    "jetta",
    "vento",
    "elantra",
    "accent",
    "sonata",
    "hb20s",
    "cerato",
    "k3",
    "k5",
    "logan",
    "voyage",
    "cronos",
    "lancer",
    "s60",
  ],
  hatch: [
    "yaris",
    "etios",
    "onix",
    "spark",
    "agile",
    "polo",
    "gol",
    "up",
    "golf",
    "swift",
    "baleno",
    "celerio",
    "picanto",
    "rio",
    "morning",
    "hb20",
    "i10",
    "grand i10",
    "i20",
    "mobi",
    "argo",
    "uno",
    "palio",
    "kwid",
    "sandero",
    "clio",
    "fit",
    "march",
    "note",
    "tiida",
    "208",
    "mazda2",
    "fiesta",
    "ka",
  ],
};

/** Minúsculas, sin tildes y con un solo espacio entre palabras. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Las claves de la tabla, de la más larga a la más corta: "corolla cross"
 * se prueba antes que "corolla" y "onix plus" antes que "onix".
 */
const LOOKUP: readonly (readonly [string, BodyType])[] = (
  Object.entries(MODELS_BY_BODY) as [BodyType, readonly string[]][]
)
  .flatMap(([body, models]) => models.map((model) => [model, body] as const))
  .sort(([a], [b]) => b.length - a.length);

/**
 * Carrocería de un modelo ("Hilux SRV 4x4" → pickup, "Corolla Cross" →
 * suv), o null si el modelo falta o no está en la tabla. El modelo coincide
 * entero o como primeras palabras: "Ranger" no coincide con "Rangers".
 */
export function bodyTypeOf(
  vehicle: Readonly<{ model?: string }>,
): BodyType | null {
  if (!vehicle.model) return null;
  const model = normalize(vehicle.model);
  for (const [key, body] of LOOKUP) {
    if (model === key || model.startsWith(`${key} `)) return body;
  }
  return null;
}

/** Nombre corto de cada carrocería (es-PY), para el texto alternativo. */
export const BODY_TYPE_LABELS: Readonly<Record<BodyType, string>> = {
  pickup: "Pickup",
  suv: "SUV",
  sedan: "Sedán",
  hatch: "Hatchback",
};
