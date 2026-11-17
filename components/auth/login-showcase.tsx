import { cn } from "@/components/ui/cn";
import { CoreDiagram } from "./core-diagram";

/*
 * Mensaje de marca del login (DEC-057), en es-PY. Cada afirmación describe
 * algo que Porandú ya hace: los cuatro scores (DEC-004), el Top Match del
 * stock (DEC-031) y la cola que dice a quién atender primero (DEC-017).
 */
export const LOGIN_TAGLINE = {
  eyebrow: "Inteligencia comercial automotriz",
  title: "El núcleo: ventas sin caos.",
  body: "Porandú consolida la cartera, el inventario y las señales de cada prospecto de tu concesionaria, dándote la claridad para decidir a quién atender primero y qué unidad ofrecerle en segundos.",
  values: [
    { label: "4 Scores de Decisión", dot: "bg-accent" },
    { label: "Top Match de Stock", dot: "bg-brand" },
    { label: "Velocidad en Salón", dot: "bg-success-bright" },
  ],
} as const;

const SHOWCASE_TITLE_ID = "login-showcase-title";

function Eyebrow() {
  return (
    <p className="inline-flex w-fit items-center rounded-full border border-navy-strong/10 bg-navy-soft px-3 py-1 text-overline text-navy uppercase">
      {LOGIN_TAGLINE.eyebrow}
    </p>
  );
}

/**
 * Columna visual del login desde `lg`: el eslogan y "El Núcleo Porandú"
 * sobre el canvas claro con un resplandor radial sutil. Hasta 1440 px el
 * eslogan va centrado arriba del diagrama; desde 1440 px (donde la columna
 * le deja al texto al menos 320 px), a la derecha del diagrama.
 */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <aside
      aria-labelledby={SHOWCASE_TITLE_ID}
      className={cn(
        "relative isolate hidden overflow-hidden bg-bg-canvas lg:flex lg:items-center lg:justify-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(55%_50%_at_50%_50%,var(--color-surface-1)_0%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(var(--color-border-default)_1px,transparent_1.5px)] [mask-image:radial-gradient(60%_55%_at_50%_50%,black,transparent)] bg-size-[22px_22px]"
      />
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -z-10 size-[36rem] -translate-1/2 rounded-full bg-[radial-gradient(closest-side,var(--color-brand-soft),transparent)]"
      />

      <div className="flex w-full max-w-5xl flex-col items-center gap-10 px-8 py-8 min-[90rem]:flex-row-reverse min-[90rem]:justify-center min-[90rem]:gap-12">
        <div className="flex max-w-lg flex-col items-center gap-4 text-center min-[90rem]:max-w-sm min-[90rem]:items-start min-[90rem]:gap-5 min-[90rem]:text-left 2xl:max-w-md">
          <Eyebrow />
          <h2
            id={SHOWCASE_TITLE_ID}
            className="text-display font-bold text-balance text-navy 2xl:text-hero"
          >
            {LOGIN_TAGLINE.title}
          </h2>
          <p className="text-lead text-pretty text-text-secondary">
            {LOGIN_TAGLINE.body}
          </p>
          <ul
            aria-label="Lo que ganás"
            className="flex flex-wrap justify-center gap-2 min-[90rem]:justify-start"
          >
            {LOGIN_TAGLINE.values.map(({ label, dot }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-label text-text-primary shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-full", dot)}
                />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <CoreDiagram />
      </div>
    </aside>
  );
}

/**
 * Encabezado compacto debajo de `lg` (teléfono y tablet): el eslogan en una
 * línea sobre el formulario, sin diagrama, para que el acceso no requiera
 * scroll ni compita con el teclado.
 */
export function LoginCompactIntro() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2 lg:hidden">
      <Eyebrow />
      <p className="text-title font-bold text-navy">{LOGIN_TAGLINE.title}</p>
    </div>
  );
}
