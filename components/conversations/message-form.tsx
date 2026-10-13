"use client";

import {
  startTransition,
  useActionState,
  useId,
  useState,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { FormField, inputClassName } from "@/components/ui/form-field";
import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTION_LABELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_FIELDS,
  MESSAGE_MAX_LENGTH,
  messageLength,
  parseMessage,
  type MessageErrors,
  type MessageField,
  type MessageFieldError,
} from "@/domains/conversations/messages";
import { addMessage } from "@/lib/conversations/actions";
import type { AddMessageState } from "@/lib/conversations/message";

/*
 * Formulario de un mensaje registrado (Hito 4, DEC-036 §6 y §11). No conoce
 * la base: envía a la Server Action addMessage() la oportunidad, el canal,
 * la dirección y el texto. Antes de enviar valida con el mismo esquema Zod
 * del dominio (parseMessage()) para avisar en el campo; el servidor lo
 * vuelve a validar y normalizar, y la base lo exige con sus CHECKs.
 *
 * Registrar no envía nada al cliente: el copy lo dice. Al guardar, el texto
 * se vacía (canal y dirección quedan para el siguiente) y la página se
 * revalida: el mensaje aparece arriba del muro, leído del servidor. Un
 * campo inválido o una falla inesperada dejan lo cargado para corregirlo o
 * reintentar.
 */

const textareaClassName =
  "min-h-24 w-full resize-y rounded-md border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

const ERRORS: Readonly<
  Record<MessageField, Partial<Record<MessageFieldError, string>>>
> = {
  channel: {
    required: "Elegí el canal.",
    invalid_option: "Elegí un canal de la lista.",
  },
  direction: {
    required: "Elegí si lo recibiste o lo enviaste.",
    invalid_option: "Elegí si lo recibiste o lo enviaste.",
  },
  content: {
    empty: "Escribí el mensaje antes de guardarlo.",
    too_long: `El mensaje puede tener hasta ${MESSAGE_MAX_LENGTH.toLocaleString("es-PY")} caracteres.`,
  },
};

function errorText(
  field: MessageField,
  error: MessageFieldError | undefined,
): string | undefined {
  if (!error) return undefined;
  return ERRORS[field][error] ?? "Revisá este dato.";
}

/** Aviso tras un pedido, o null si no hay nada que avisar. */
function noticeOf(
  state: AddMessageState,
): { text: string; tone: "info" | "error" } | null {
  switch (state?.status) {
    case undefined:
    case "invalid":
      return null;
    case "recorded":
      return { text: "Mensaje registrado en la actividad.", tone: "info" };
    case "not_found":
      return { text: "No encontramos la oportunidad.", tone: "error" };
    case "failed":
      return {
        text: "No pudimos registrar el mensaje. No se guardó nada: intentá de nuevo en unos minutos.",
        tone: "error",
      };
  }
}

const FIELD_ORDER: readonly MessageField[] = [
  "channel",
  "direction",
  "content",
];

export function MessageForm({ opportunityId }: { opportunityId: string }) {
  const id = useId();
  const [channel, setChannel] = useState<string>("whatsapp");
  const [direction, setDirection] = useState("");
  const [content, setContent] = useState("");
  const [localErrors, setLocalErrors] = useState<MessageErrors | null>(null);
  const [state, action, pending] = useActionState<AddMessageState, FormData>(
    async (previous, formData) => {
      const result = await addMessage(previous, formData);
      if (result?.status === "recorded") setContent("");
      return result;
    },
    null,
  );

  const errors: MessageErrors =
    localErrors ??
    (!pending && state?.status === "invalid" ? state.errors : {});
  const notice = pending ? null : noticeOf(state);
  const length = messageLength(content);
  const tooLong = length > MESSAGE_MAX_LENGTH;
  const fieldId = (field: MessageField) => `${id}-${field}`;
  const errorId = (field: MessageField) => `${id}-${field}-error`;
  const countId = `${id}-count`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const checked = parseMessage({ channel, direction, content });
    if (!checked.ok) {
      setLocalErrors(checked.errors);
      // El foco va al primer campo con error, que lo anuncia.
      const first = FIELD_ORDER.find((field) => checked.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setLocalErrors(null);
    const formData = new FormData(form);
    startTransition(() => action(formData));
  }

  const contentError = errorText("content", errors.content);

  return (
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <input
        type="hidden"
        name={MESSAGE_FIELDS.opportunityId}
        value={opportunityId}
      />
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Canal"
            htmlFor={fieldId("channel")}
            error={errorText("channel", errors.channel)}
            errorId={errorId("channel")}
          >
            <select
              id={fieldId("channel")}
              name={MESSAGE_FIELDS.channel}
              value={channel}
              onChange={(event) => setChannel(event.currentTarget.value)}
              disabled={pending}
              aria-invalid={errors.channel ? true : undefined}
              aria-describedby={errors.channel ? errorId("channel") : undefined}
              className={inputClassName}
            >
              {MESSAGE_CHANNELS.map((option) => (
                <option key={option} value={option}>
                  {MESSAGE_CHANNEL_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Dirección"
            htmlFor={fieldId("direction")}
            error={errorText("direction", errors.direction)}
            errorId={errorId("direction")}
          >
            <select
              id={fieldId("direction")}
              name={MESSAGE_FIELDS.direction}
              value={direction}
              onChange={(event) => setDirection(event.currentTarget.value)}
              disabled={pending}
              aria-invalid={errors.direction ? true : undefined}
              aria-describedby={
                errors.direction ? errorId("direction") : undefined
              }
              className={inputClassName}
            >
              <option value="" disabled>
                Elegí
              </option>
              {MESSAGE_DIRECTIONS.map((option) => (
                <option key={option} value={option}>
                  {MESSAGE_DIRECTION_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={fieldId("content")}
            className="text-label text-text-secondary"
          >
            Mensaje
          </label>
          <textarea
            id={fieldId("content")}
            name={MESSAGE_FIELDS.content}
            rows={3}
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            disabled={pending}
            placeholder="Lo que escribió el cliente o lo que le respondiste…"
            aria-invalid={contentError || tooLong ? true : undefined}
            aria-describedby={
              cn(countId, contentError ? errorId("content") : null) || undefined
            }
            className={textareaClassName}
          />
          <div className="flex items-start justify-between gap-3">
            <p
              id={errorId("content")}
              className={cn(
                "text-caption text-danger",
                !contentError && "sr-only",
              )}
            >
              {contentError}
            </p>
            <p
              id={countId}
              className={cn(
                "shrink-0 text-caption tabular-nums",
                tooLong ? "text-danger" : "text-text-muted",
              )}
            >
              {length.toLocaleString("es-PY")} /{" "}
              {MESSAGE_MAX_LENGTH.toLocaleString("es-PY")}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-1 text-caption text-text-muted">
        Registrar no envía nada al cliente: deja constancia de lo que ya pasó.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Guardando…" : "Registrar mensaje"}
        </Button>
        <p
          role="status"
          className={cn(
            "text-caption",
            notice
              ? notice.tone === "error"
                ? "text-danger"
                : "text-success"
              : "sr-only",
          )}
        >
          {notice?.text}
        </p>
      </div>
    </form>
  );
}
