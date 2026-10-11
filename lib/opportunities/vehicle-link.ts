import type { Stage } from "@/domains/opportunities/stages";
import { VEHICLE_LINK_FIELDS } from "@/domains/opportunities/vehicle-link";

/*
 * Pedido y respuesta de la Server Action linkOpportunityVehicle() (Hito 2,
 * DEC-033 §2). El pedido solo identifica la oportunidad y la unidad (vacía
 * para quitar el vínculo): cualquier otro campo (organización, etapa, estado
 * de la unidad, reloj) se ignora porque no tiene adónde ir. Nada de esto
 * expone la base: ni SQLSTATE, ni constraints, ni datos de otra organización.
 */

/** Respuesta de linkOpportunityVehicle(). */
export type LinkVehicleState =
  /** La unidad quedó vinculada a la negociación. */
  | Readonly<{ status: "linked"; opportunityId: string; vehicleId: string }>
  /** Se quitó la unidad vinculada. */
  | Readonly<{ status: "unlinked"; opportunityId: string }>
  /** Ya estaba así (p. ej. otra persona la vinculó antes). */
  | Readonly<{
      status: "unchanged";
      opportunityId: string;
      vehicleId: string | null;
    }>
  /** La etapa no admite cambiar la unidad. `stage` es la real. */
  | Readonly<{
      status: "stage_not_allowed";
      opportunityId: string;
      stage: Stage;
    }>
  /** La unidad no existe en la organización activa. Nada cambió. */
  | Readonly<{ status: "vehicle_not_found" }>
  /** La unidad ya no está disponible. Nada cambió. */
  | Readonly<{ status: "vehicle_not_available" }>
  /** La unidad ya no es un match de lo que busca el cliente. Nada cambió. */
  | Readonly<{ status: "not_a_match" }>
  /** El pedido no trae la unidad. Nada cambió. */
  | Readonly<{ status: "invalid" }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada cambió y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedVehicleLink =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      /** null: quitar el vínculo. */
      vehicleId: string | null;
    }>
  /** El id de la oportunidad no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** El id de la unidad no es un UUID: no llega a la base. */
  | Readonly<{ kind: "vehicle_not_found" }>
  /** El pedido no trae el campo de la unidad. */
  | Readonly<{ kind: "invalid" }>;

function text(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Lee el pedido, que es input no confiable. El campo de la unidad es
 * obligatorio: vacío quita el vínculo y, si no, tiene que ser un UUID. Que
 * los ids sean UUID no significa que oportunidad y unidad sean de la
 * organización activa: eso lo deciden el filtro explícito, RLS y la FK
 * compuesta.
 */
export function parseVehicleLink(formData: FormData): ParsedVehicleLink {
  const id = text(formData.get(VEHICLE_LINK_FIELDS.opportunityId)) ?? "";
  if (!UUID.test(id)) return { kind: "not_found" };

  const vehicleId = text(formData.get(VEHICLE_LINK_FIELDS.vehicleId));
  if (vehicleId === null) return { kind: "invalid" };
  if (vehicleId !== "" && !UUID.test(vehicleId)) {
    return { kind: "vehicle_not_found" };
  }
  return {
    kind: "ok",
    opportunityId: id.toLowerCase(),
    vehicleId: vehicleId === "" ? null : vehicleId.toLowerCase(),
  };
}
