"use client";

import "./picker.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StockVehicle } from "@/domains/vehicles/stock";

import { PrototypeShell } from "./_shell";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";
import { VariantD } from "./variant-d";

/*
 * PROTOTIPO: harness de /prototypes/stock con el picker de la skill
 * `prototype` (verbatim). Una variante a la vez, a tamaño real, dentro del
 * shell. El cambio de variante es instantáneo.
 */

const VARIANTS = [
  { name: "Tabla de inventario", render: VariantA },
  { name: "Filas de unidad", render: VariantB },
  { name: "Workspace", render: VariantC },
  { name: "Híbrida", render: VariantD },
] as const;

export function Harness({
  vehicles,
  initial,
}: {
  vehicles: readonly StockVehicle[];
  initial: number;
}) {
  const [current, setCurrent] = useState(
    initial >= 0 && initial < VARIANTS.length ? initial : 0,
  );
  const [ready, setReady] = useState(false);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
  }, []);

  useLayoutEffect(() => {
    const move = () => {
      const el = itemRefs.current[current];
      const highlight = highlightRef.current;
      if (!el || !highlight) return;
      highlight.style.width = `${el.offsetWidth}px`;
      highlight.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [current]);

  function select(i: number) {
    if (i < 0 || i >= VARIANTS.length) return;
    setCurrent(i);
    const url = new URL(location.href);
    url.searchParams.set("v", String(i + 1));
    history.replaceState(null, "", url);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= VARIANTS.length) select(num - 1);
      else if (e.key === "ArrowRight") select((current + 1) % VARIANTS.length);
      else if (e.key === "ArrowLeft")
        select((current - 1 + VARIANTS.length) % VARIANTS.length);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const Variant = VARIANTS[current]!.render;
  return (
    <>
      <PrototypeShell>
        <Variant key={current} vehicles={vehicles} />
      </PrototypeShell>
      <nav
        ref={pickerRef}
        className="proto-picker"
        aria-label="Prototype variants"
        data-ready={ready ? "" : undefined}
      >
        <span
          ref={highlightRef}
          className="proto-picker-highlight"
          aria-hidden="true"
        />
        {VARIANTS.map((variant, i) => (
          <button
            key={variant.name}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            className="proto-picker-item"
            data-active={i === current ? "" : undefined}
            aria-current={i === current ? "true" : undefined}
            onClick={() => select(i)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  );
}
