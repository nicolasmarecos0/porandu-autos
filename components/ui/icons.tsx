import type { SVGProps } from "react";

/*
 * Íconos de línea propios (24×24, trazo 1.75, `currentColor`).
 * Se dibujan inline para no sumar una dependencia de íconos en B1.
 * Son decorativos: el texto visible acompaña siempre al ícono.
 */

export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CockpitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l3.5-4.5" />
      <circle cx="12" cy="16" r="1.25" />
      <path d="M4 20h16" />
    </Icon>
  );
}

export function OpportunitiesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" />
    </Icon>
  );
}

export function StockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 13l1.4-4.1A2 2 0 0 1 7.8 7.5h8.4a2 2 0 0 1 1.9 1.4l1.4 4.1" />
      <rect x="3" y="13" width="18" height="4.5" rx="1.5" />
      <path d="M6.5 17.5V19.5M17.5 17.5V19.5" />
      <path d="M6.5 15.25h1M16.5 15.25h1" />
    </Icon>
  );
}

export function ConversationsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.2-4A7.5 7.5 0 1 1 20 11.5z" />
    </Icon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Icon>
  );
}

export function RecoveryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9" />
    </Icon>
  );
}

export function IntelligenceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2.5-6.5 5 13L17 12h4" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}

/* Íconos de contenido (Opportunities). */

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20.5s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0c0 4.9 6.5 10.5 6.5 10.5z" />
      <circle cx="12" cy="10" r="2.25" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h3.2l1.6 4-2 1.3a10 10 0 0 0 6.4 6.4l1.3-2 4 1.6V19a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5z" />
    </Icon>
  );
}

export function SteeringIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M4.5 10.5l5.6 1M19.5 10.5l-5.6 1M12 14v6" />
    </Icon>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
      <path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5" />
    </Icon>
  );
}

/** Nota de la bitácora comercial: renglones y un lápiz. */
export function NoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.5h11M4.5 11h8M4.5 15.5h4.5" />
      <path d="M13.5 20.5l.6-2.9 5.6-5.6a1.6 1.6 0 0 1 2.3 2.3l-5.6 5.6z" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </Icon>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M16 13.5h1.5" />
    </Icon>
  );
}

export function PercentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6L6 18" />
      <circle cx="7.5" cy="7.5" r="2" />
      <circle cx="16.5" cy="16.5" r="2" />
    </Icon>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8l8-4 8 4-8 4-8-4z" />
      <path d="M4 8v8l8 4 8-4V8M12 12v8" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.75" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 6l-6 6 6 6" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </Icon>
  );
}

/** Dos tildes: entregado o leído (estado de entrega de WhatsApp). */
export function DoubleCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12.5l4.5 4.5 9.5-9.5" />
      <path d="M12 16.5l.5.5 9-9.5" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.25h.01" />
    </Icon>
  );
}

/** Dos franjas que se pisan: la misma unidad en dos pruebas cercanas. */
export function OverlapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="8" width="12" height="10" rx="2" />
      <rect x="9" y="5" width="12" height="10" rx="2" />
    </Icon>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 14L4.5 9.5 9 5" />
      <path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon strokeWidth={3} {...props}>
      <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
    </Icon>
  );
}

/** Lista de filas: la cola de oportunidades. */
export function QueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </Icon>
  );
}

/** Columnas de un tablero: el embudo de ventas por etapa. */
export function BoardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="4.5" height="15" rx="1.5" />
      <rect x="9.75" y="4.5" width="4.5" height="11" rx="1.5" />
      <rect x="16" y="4.5" width="4.5" height="7" rx="1.5" />
    </Icon>
  );
}

/** Columnas sobre una línea base: las Métricas del salón. */
export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 19.5h16" />
      <path d="M7 16v-5M12 16V6.5M17 16v-3" />
    </Icon>
  );
}

/** Cuadrícula de tarjetas: el catálogo visual del stock. */
export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Icon>
  );
}

/** Cámara: el lugar de las fotos reales de una unidad (vehicle_media). */
export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.25" />
    </Icon>
  );
}
