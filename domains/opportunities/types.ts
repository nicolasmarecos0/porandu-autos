import type { Driver, ScoreSet } from "@/domains/scoring/types";
import type {
  AlternativeMatch,
  BodyType,
  TradeIn,
  VehicleMatch,
} from "@/domains/vehicles/types";

export type Advisor = {
  id: string;
  name: string;
  initials: string;
};

export type Channel = "WhatsApp" | "Meta Ads" | "Web" | "Showroom" | "Referido";

/**
 * Origen comercial de una oportunidad, tal como se persiste (`source`). Es el
 * canal por el que llegó el interés, no el método de carga: un alta manual
 * también declara su origen.
 */
export type OpportunitySource =
  "whatsapp" | "meta_ads" | "web" | "showroom" | "referral";

/** Etapas del pipeline baseline (Master Context §6). */
export type Stage = "new" | "qualified" | "testDrive" | "negotiation";

/** Urgencia de la cola: cuándo conviene actuar. */
export type Bucket = "now" | "today" | "followUp";

export type NbaKind =
  "call" | "message" | "testDrive" | "offer" | "tradeIn" | "visit";

/** Next Best Action: 1 acción primaria con su porqué y hasta 2 secundarias. */
export type NextBestAction = {
  kind: NbaKind;
  action: string;
  reason: string;
  secondary: readonly string[];
  /** Cambia condiciones económicas: requiere aprobación humana. */
  needsApproval?: boolean;
};

/*
 * ViewModel de Opportunities (DEC-015, DEC-017). Un campo opcional que no
 * llega es "sin dato": la UI no lo muestra y nunca se completa con un valor
 * inventado. En Hito 1 la fuente real (PostgreSQL) solo trae lo persistido y
 * lo derivado; la inteligencia (scores, NBA, señales, matches, trade-in,
 * conversación en vivo) llega cuando exista su motor.
 */
export type Opportunity = {
  id: string;
  prospect: {
    name: string;
    initials: string;
    /** Enmascarado en la UI. */
    phone?: string;
    city?: string;
    channel: Channel;
    /** Conversación de WhatsApp activa (`● En vivo`). */
    live: boolean;
    company?: { contact: string };
  };
  /** Vehículo que busca. */
  interest: {
    model?: string;
    version?: string;
    condition?: string;
    body?: BodyType;
    budget?: string;
    payment?: string;
    quantity?: number;
  };
  scores: ScoreSet;
  lastActivity: {
    /** Minutos desde la última actividad. */
    minutes: number;
    summary?: string;
  };
  owner?: Advisor;
  stage: Stage;
  bucket: Bucket;
  nba?: NextBestAction;
  drivers: readonly Driver[];
  topMatch?: VehicleMatch;
  alternative?: AlternativeMatch;
  tradeIn?: TradeIn;
};
