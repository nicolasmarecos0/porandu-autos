"use client";

import {
  useActionState,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { demandEditChanges, demandFormBaseline } from "@/domains/demand/edit";
import type { DemandFact } from "@/domains/demand/facts";
import {
  DEMAND_EDIT_FIELDS,
  DEMAND_FORM_FIELDS,
  DEMAND_FORM_FIELDS_BY_FACT,
  DEMAND_FORM_MAX_LENGTH,
  type DemandFormValues,
} from "@/domains/demand/form";
import { NO_DATA, type DemandSummary } from "@/domains/demand/presentation";
import { recordDemand } from "@/lib/opportunities/actions";
import type { RecordDemandState } from "@/lib/opportunities/record-demand";

import { DemandFields, demandErrorMessage } from "./demand-fields";

/*
 * Edición de "Lo que busca" (H1.4, DEC-030 §10): drawer con los mismos
 * campos y el mismo orden que el alta, precargados con el valor vigente
 * (nunca con el legado). No conoce la base: envía a la Server Action
 * recordDemand() solo los facts modificados, cada uno con el head que vio
 * el usuario (compare-and-set).
 *
 * - Vaciar un campo que tenía valor muestra "Se va a quitar (error de
 *   carga)" y se envía como Quitar.
 * - Junto a cada valor humano modificado, "Fue un error de carga",
 *   destildado: por defecto, el cliente cambió.
 * - "Nota de la edición", opcional, sin datos personales.
 * - Si otro miembro cambió un dato mientras se editaba, nada se guarda: lo
 *   tipeado queda y los valores vigentes se refrescan para revisarlos.
 */

export type DemandSaved = Extract<
  RecordDemandState,
  { status: "saved" | "unchanged" }
>;

type DemandEditDrawerProps = {
  opportunityId: string;
  summary: DemandSummary;
  onSaved: (saved: DemandSaved) => void;
};

export function DemandEditDrawer({
  opportunityId,
  summary,
  onSaved,
}: DemandEditDrawerProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Mientras se guarda, ni Escape, ni el velo, ni el botón cierran.
  const keepOpenWhileSaving = (event: Event) => {
    if (saving) event.preventDefault();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        setOpen(next);
      }}
    >
      <DrawerTrigger asChild>
        <Button variant="secondary">Editar</Button>
      </DrawerTrigger>
      <DrawerContent
        title="Lo que busca"
        description="Solo se guardan los datos que cambies. Lo que no sepas, dejalo sin dato."
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <DemandEditForm
          opportunityId={opportunityId}
          summary={summary}
          firstFieldRef={firstFieldRef}
          onSavingChange={setSaving}
          onSaved={(saved) => {
            setSaving(false);
            setOpen(false);
            onSaved(saved);
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}

/** Copy es-PY del resultado. Ninguno expone detalles internos. */
const FORM_MESSAGES = {
  invalid: "Revisá los datos marcados.",
  stale: "Este dato cambió mientras editabas. Revisá los valores actuales.",
  pending:
    "Hay un dato detectado sin revisar en este campo. Revisalo antes de editarlo.",
  inconsistent: "No pudimos leer este dato. Avisá al administrador.",
  not_found: "Esta oportunidad ya no está disponible. Recargá la página.",
  failed:
    "No pudimos guardar. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

type DemandEditFormProps = {
  opportunityId: string;
  summary: DemandSummary;
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onSavingChange: (saving: boolean) => void;
  onSaved: (saved: DemandSaved) => void;
};

function DemandEditForm({
  opportunityId,
  summary,
  firstFieldRef,
  onSavingChange,
  onSaved,
}: DemandEditFormProps) {
  const [state, action, pending] = useActionState<RecordDemandState, FormData>(
    recordDemand,
    null,
  );
  const id = useId();
  const submitRef = useRef<HTMLButtonElement>(null);
  const [values, setValues] = useState<DemandFormValues>(() =>
    demandFormBaseline(summary),
  );
  const [note, setNote] = useState("");
  const [loadErrors, setLoadErrors] = useState<ReadonlySet<DemandFact>>(
    new Set(),
  );

  // Contra el valor vigente de ahora: si otro miembro lo cambió, la página
  // se revalidó y `summary` ya es el nuevo.
  const changes = demandEditChanges(summary, values);
  const changed = new Map(changes.map((change) => [change.fact, change]));
  const staleFacts: readonly DemandFact[] =
    state?.status === "stale" || state?.status === "pending" ? state.facts : [];
  const errors = state?.status === "invalid" ? state.errors : {};
  const message =
    !pending &&
    state &&
    state.status !== "saved" &&
    state.status !== "unchanged"
      ? FORM_MESSAGES[state.status]
      : null;
  const isError =
    state?.status === "failed" ||
    state?.status === "inconsistent" ||
    state?.status === "not_found";

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  // Al terminar: guardado (o sin cambios) cierra; un error enfoca el primer
  // campo a corregir y, si no, el botón para reintentar.
  const settle = useEffectEvent(() => {
    if (state?.status === "saved" || state?.status === "unchanged") {
      onSaved(state);
    } else if (state?.status === "invalid") {
      const first = [...DEMAND_FORM_FIELDS, "note" as const].find(
        (field) => state.errors[field],
      );
      if (first) document.getElementById(`${id}-${first}`)?.focus();
    } else if (state) {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  const fieldFact = (field: (typeof DEMAND_FORM_FIELDS)[number]) =>
    (Object.keys(DEMAND_FORM_FIELDS_BY_FACT) as DemandFact[]).find((fact) =>
      DEMAND_FORM_FIELDS_BY_FACT[fact].includes(field),
    )!;

  const footerOf = (fact: DemandFact) => {
    const change = changed.get(fact);
    const current = summary.facts[fact];
    return (
      <>
        {staleFacts.includes(fact) ? (
          <p className="text-caption text-warning">
            Ahora: {current.display ?? NO_DATA}
          </p>
        ) : null}
        {change?.kind === "remove" ? (
          <p className="text-caption text-warning">
            Se va a quitar (error de carga).
          </p>
        ) : null}
        {change?.canBeLoadError ? (
          <label className="flex items-center gap-2 text-caption text-text-secondary">
            <input
              type="checkbox"
              name={DEMAND_EDIT_FIELDS.loadError(fact)}
              checked={loadErrors.has(fact)}
              disabled={pending}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setLoadErrors((current) => {
                  const next = new Set(current);
                  if (checked) next.add(fact);
                  else next.delete(fact);
                  return next;
                });
              }}
              className="size-3.5 accent-brand"
            />
            Fue un error de carga
          </label>
        ) : null}
      </>
    );
  };

  return (
    <form
      action={action}
      noValidate
      aria-busy={pending}
      className="flex min-h-0 flex-1 flex-col"
    >
      <input
        type="hidden"
        name={DEMAND_EDIT_FIELDS.opportunityId}
        value={opportunityId}
      />
      {changes.map(({ fact }) => (
        <span key={fact} hidden>
          <input type="hidden" name={DEMAND_EDIT_FIELDS.changed} value={fact} />
          <input
            type="hidden"
            name={DEMAND_EDIT_FIELDS.head(fact)}
            value={summary.facts[fact].headId ?? ""}
          />
          <input
            type="hidden"
            name={DEMAND_EDIT_FIELDS.current(fact)}
            value={summary.facts[fact].currentFactId ?? ""}
          />
        </span>
      ))}

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {message ? (
          <p
            role="alert"
            className={
              isError
                ? "rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
                : "rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-label text-warning"
            }
          >
            {message}
          </p>
        ) : null}

        <DemandFields
          idPrefix={id}
          values={values}
          onChange={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
          errors={errors}
          disabled={pending}
          // Solo viajan los campos de los facts modificados.
          nameOf={(field) =>
            changed.has(fieldFact(field)) ? field : undefined
          }
          footerOf={footerOf}
          firstFieldRef={firstFieldRef}
        />

        <FormField
          label="Nota de la edición"
          optional
          htmlFor={`${id}-note`}
          hint="Opcional. No incluyas datos personales."
          hintId={`${id}-note-hint`}
          error={errors.note && demandErrorMessage("note", errors.note)}
          errorId={`${id}-note-error`}
        >
          <input
            id={`${id}-note`}
            name={DEMAND_EDIT_FIELDS.note}
            type="text"
            autoComplete="off"
            maxLength={DEMAND_FORM_MAX_LENGTH.note}
            value={note}
            disabled={pending}
            onChange={(event) => setNote(event.currentTarget.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={[
              `${id}-note-hint`,
              errors.note ? `${id}-note-error` : null,
            ]
              .filter(Boolean)
              .join(" ")}
            className={inputClassName}
          />
        </FormField>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3">
        <p className="mr-auto text-caption text-text-muted" aria-live="polite">
          {changes.length === 0
            ? "Sin cambios"
            : changes.length === 1
              ? "1 dato modificado"
              : `${changes.length} datos modificados`}
        </p>
        <DrawerClose asChild>
          <Button variant="secondary" disabled={pending}>
            Cancelar
          </Button>
        </DrawerClose>
        <Button
          ref={submitRef}
          type="submit"
          variant="primary"
          disabled={pending || changes.length === 0}
          className="disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </footer>
    </form>
  );
}
