"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button, buttonClassName } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/form-field";
import { stageLabel } from "@/domains/opportunities/labels";
import type { QuoteCustomerOption } from "@/domains/vehicles/catalog";
import { OPPORTUNITIES_PATH } from "@/lib/opportunities/paths";
import { newQuoteHref } from "@/lib/quotes/paths";

/*
 * Atajo "Cotizar" de la vista de detalle (propuesta DEC-049). Una
 * cotización es de una unidad para una oportunidad (DEC-042 §1): acá solo
 * se elige el cliente, y el atajo lleva a su oportunidad con "Nueva
 * cotización" abierta y la unidad elegida. El descuento, la validez, la
 * aprobación humana y la entrega siguen en el panel "Cotizaciones" de la
 * oportunidad, con sus reglas. El catálogo no crea nada.
 *
 * La lista de clientes aparece solo cuando el vendedor toca "Cotizar": el
 * catálogo se le muestra al cliente y no exhibe a los demás.
 */

export function QuoteLauncher({
  vehicleId,
  customers,
  onCancel,
}: {
  vehicleId: string;
  customers: readonly QuoteCustomerOption[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [opportunityId, setOpportunityId] = useState("");
  const [pending, setPending] = useState(false);

  // Al abrir, el foco va al cliente: es lo único que falta elegir.
  useEffect(() => selectRef.current?.focus(), []);

  if (customers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-label text-text-secondary">
          No hay oportunidades En calificación o En negociación. Para cotizar,
          pasá la oportunidad del cliente a En calificación.
        </p>
        <div className="flex gap-2">
          <Button onClick={onCancel} className="h-10 flex-1">
            Volver
          </Button>
          <Link
            href={OPPORTUNITIES_PATH}
            prefetch={false}
            className={buttonClassName("secondary", "h-10 flex-1")}
          >
            Ir a Oportunidades
          </Link>
        </div>
      </div>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (opportunityId === "" || pending) return;
    setPending(true);
    router.push(newQuoteHref(opportunityId, vehicleId));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-customer`}
          className="text-label text-text-secondary"
        >
          ¿Para qué cliente es la cotización?
        </label>
        <select
          ref={selectRef}
          id={`${id}-customer`}
          value={opportunityId}
          onChange={(event) => setOpportunityId(event.target.value)}
          required
          aria-describedby={`${id}-hint`}
          className={`${inputClassName} h-10 text-[1rem] sm:text-body`}
        >
          <option value="">Elegí un cliente</option>
          {customers.map((customer) => (
            <option key={customer.opportunityId} value={customer.opportunityId}>
              {customer.contactName} · {stageLabel(customer.stage)}
            </option>
          ))}
        </select>
        <p id={`${id}-hint`} className="text-caption text-text-muted">
          Oportunidades En calificación o En negociación, de la más activa a la
          menos. El descuento y la aprobación se completan en la oportunidad.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onCancel} disabled={pending} className="h-10 flex-1">
          Volver
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={opportunityId === "" || pending}
          className="h-10 flex-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Abriendo…" : "Continuar"}
        </Button>
      </div>
    </form>
  );
}
