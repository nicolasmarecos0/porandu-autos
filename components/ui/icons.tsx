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
