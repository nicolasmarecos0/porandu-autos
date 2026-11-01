"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { LinkedOpportunity } from "@/domains/conversations/opportunity-link";
import { formatCount } from "@/domains/dashboard/presentation";

/*
 * Las oportunidades abiertas de un contacto con varias (Hito 12, DEC-044
 * §4), en un menú de Radix: abre con click, Enter, Espacio o flecha abajo y
 * cada opción lleva a su oportunidad. Solo navega: elegir una no asocia
 * nada (la asociación la decide la base al registrar cada mensaje).
 */

export function OpportunityMenu({
  opportunities,
  total,
}: {
  opportunities: readonly LinkedOpportunity[];
  total: number;
}) {
  const router = useRouter();
  const hidden = total - opportunities.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="ml-auto h-7 px-2.5">
          Ver oportunidades
          <ChevronDownIcon width={14} height={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>
          Oportunidades abiertas del contacto
        </DropdownMenuLabel>
        {opportunities.map((opportunity) => (
          <DropdownMenuItem
            key={opportunity.id}
            onSelect={() => router.push(opportunity.href)}
          >
            <span className="truncate">
              {opportunity.stage}
              <span className="font-normal text-text-muted">
                {" "}
                · actividad {opportunity.lastActivity}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        {hidden > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              Y {formatCount(hidden)} más en Oportunidades.
            </DropdownMenuLabel>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
