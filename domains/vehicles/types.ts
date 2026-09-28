/* Vehículos en el contexto de una oportunidad (Vehicle Rail). */

export type BodyType = "pickup" | "suv" | "sedan" | "hatch";

export type VehicleMatch = {
  name: string;
  year: number;
  km: string;
  price: string;
  /** `null` = no se puede calcular con las preferencias conocidas. */
  match: number | null;
  specs: string;
  reasons: readonly string[];
  installment?: string;
  body: BodyType;
};

export type AlternativeMatch = {
  name: string;
  year: number;
  price: string;
  match: number | null;
};

/** Estados del trade-in: el valor estimado no es el aprobado. */
export type TradeInStatus = "Detectado" | "Estimado" | "Tasado" | "Aprobado";

export type TradeIn = {
  vehicle: string;
  km: string;
  status: TradeInStatus;
  value?: string;
};
