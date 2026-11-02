"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DownloadIcon } from "@/components/ui/icons";
import {
  isQuoteExportBlock,
  QUOTE_EXPORT_BLOCK_LABELS,
} from "@/domains/quotes/exportability";
import { quotePdfPath } from "@/lib/quotes/paths";

/*
 * "Descargar PDF" (Hito 14, DEC-046 §6): pide el presupuesto a
 * GET /api/quotes/[quoteId]/pdf y lo guarda con el nombre que decide el
 * servidor. Solo se muestra para una cotización que se puede descargar
 * (QuoteCardView.exportability), pero quien decide es el servidor: si
 * mientras tanto otra persona la anuló o venció, responde 409 con el
 * motivo, el botón lo muestra y la página se refresca con el estado real.
 *
 * Se descarga con fetch() y no con un enlace directo para que un error se
 * explique acá, en es-PY, y no abra una pestaña con un JSON. Descargar no
 * cambia nada: no marca la cotización como enviada (DEC-042 §6).
 */

type DownloadState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "downloading" }>
  | Readonly<{ kind: "done"; fileName: string }>
  | Readonly<{ kind: "error"; message: string }>;

const FAILED =
  "No pudimos generar el PDF. No cambió nada: intentá de nuevo en unos minutos.";

/** Copy de cada respuesta de error del servidor. */
function errorMessage(status: number, body: unknown): string {
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar para descargar el PDF.";
  }
  if (status === 403) {
    return "No pudimos confirmar tu acceso a esta organización. Recargá la página.";
  }
  if (status === 404) {
    return "No encontramos la cotización. Puede que ya no exista.";
  }
  if (
    status === 409 &&
    typeof body === "object" &&
    body !== null &&
    "reason" in body &&
    isQuoteExportBlock(body.reason)
  ) {
    return QUOTE_EXPORT_BLOCK_LABELS[body.reason];
  }
  return FAILED;
}

const FILE_NAME = /filename="([^"]+)"/;

/** El nombre que eligió el servidor (Content-Disposition), o el de respaldo. */
function fileNameOf(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  return FILE_NAME.exec(header)?.[1] ?? fallback;
}

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Safari todavía puede estar leyendo el blob al volver de click().
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function DownloadQuotePdf({
  quoteId,
  numberLabel,
  variant = "primary",
  className,
}: {
  quoteId: string;
  /** "N.º 0007": accesible y nombre de respaldo del archivo. */
  numberLabel: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<DownloadState>({ kind: "idle" });
  const downloading = state.kind === "downloading";
  const fallbackName = `presupuesto-${numberLabel.replace(/\D/g, "")}.pdf`;

  async function download() {
    if (downloading) return;
    setState({ kind: "downloading" });
    let response: Response;
    try {
      response = await fetch(quotePdfPath(quoteId), {
        headers: { Accept: "application/pdf" },
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      setState({
        kind: "error",
        message:
          "No pudimos conectarnos para descargar el PDF. Revisá la conexión e intentá de nuevo.",
      });
      return;
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      setState({ kind: "error", message: errorMessage(response.status, body) });
      // La cotización cambió o ya no está: la página muestra el estado real.
      if (response.status === 404 || response.status === 409) {
        startTransition(() => router.refresh());
      }
      return;
    }
    try {
      const fileName = fileNameOf(response, fallbackName);
      save(await response.blob(), fileName);
      setState({ kind: "done", fileName });
    } catch {
      setState({ kind: "error", message: FAILED });
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Button
        variant={variant}
        onClick={download}
        disabled={downloading}
        aria-busy={downloading}
        className="disabled:cursor-wait disabled:opacity-70"
      >
        <DownloadIcon className="size-4" />
        {/* El nombre accesible empieza con el texto visible (WCAG 2.5.3). */}
        <span>
          {downloading ? "Generando PDF…" : "Descargar PDF"}
          <span className="sr-only"> del presupuesto {numberLabel}</span>
        </span>
      </Button>
      <p role="status" className="sr-only">
        {state.kind === "done"
          ? `Presupuesto ${numberLabel} descargado como ${state.fileName}.`
          : ""}
      </p>
      {state.kind === "error" ? (
        <p
          role="alert"
          className="rounded-sm border border-danger-border bg-danger-soft px-2 py-1.5 text-caption text-danger"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
