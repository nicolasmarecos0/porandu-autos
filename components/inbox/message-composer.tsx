"use client";

import { useRouter } from "next/navigation";
import {
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Kbd } from "@/components/ui/kbd";
import {
  MESSAGE_MAX_LENGTH,
  messageLength,
} from "@/domains/conversations/messages";
import { parseSendMessage } from "@/domains/conversations/outbound";

import {
  invalidNotice,
  NETWORK_NOTICE,
  sendFeedback,
  type SendNotice,
} from "./send-feedback";

/*
 * Composer de la bandeja (Hito 8, DEC-040 §2): un miembro le responde al
 * cliente por WhatsApp. No conoce la base ni a Meta: envía a POST
 * /api/messages/send la conversación y el texto. Antes de enviar valida con
 * el mismo esquema Zod del dominio (parseSendMessage()); el servidor lo
 * vuelve a validar, resuelve el tenant y la línea, y registra lo que Meta
 * aceptó.
 *
 * Enviar es irreversible: lo dispara solo el botón o Enter (Shift+Enter es
 * una línea nueva), nunca nada automático. Al enviar, el texto se vacía y la
 * página se refresca: el mensaje aparece al pie del historial, leído del
 * servidor. Una falla deja lo escrito y dice si el cliente lo recibió.
 */

export const SEND_ENDPOINT = "/api/messages/send";

const textareaClassName =
  "min-h-20 w-full resize-y rounded-md border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

export function MessageComposer({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<SendNotice | null>(null);
  /** El aviso es sobre el texto (vacío o largo), no sobre el envío. */
  const [fieldError, setFieldError] = useState(false);
  const [refreshing, startTransition] = useTransition();

  const length = messageLength(text);
  const tooLong = length > MESSAGE_MAX_LENGTH;
  const busy = sending || refreshing;
  const textId = `${id}-text`;
  const countId = `${id}-count`;
  const hintId = `${id}-hint`;
  const noticeId = `${id}-notice`;

  async function send() {
    if (busy) return;
    const parsed = parseSendMessage({ conversationId, text });
    if (!parsed.ok) {
      setNotice(invalidNotice(parsed.errors));
      setFieldError(true);
      field.current?.focus();
      return;
    }
    setSending(true);
    setNotice(null);
    setFieldError(false);
    let next: SendNotice;
    try {
      const response = await fetch(SEND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.request),
      });
      const body: unknown = await response.json().catch(() => null);
      next = sendFeedback(response.ok, body);
      setFieldError(response.status === 400 || response.status === 413);
      if (response.ok) {
        setText("");
        startTransition(() => router.refresh());
      }
    } catch {
      next = NETWORK_NOTICE;
    }
    setNotice(next);
    setSending(false);
    if (next.tone === "error") field.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={busy}
      className="flex flex-col gap-2 border-t border-border-subtle bg-surface-2 px-4 py-3"
    >
      <label htmlFor={textId} className="sr-only">
        Respuesta por WhatsApp
      </label>
      <textarea
        ref={field}
        id={textId}
        rows={2}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={keyDown}
        disabled={sending}
        placeholder="Escribí una respuesta por WhatsApp…"
        aria-invalid={fieldError || tooLong ? true : undefined}
        aria-describedby={cn(hintId, countId, notice ? noticeId : null)}
        className={textareaClassName}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          id={hintId}
          className="flex items-center gap-1 text-caption text-text-muted"
        >
          <Kbd>Enter</Kbd> envía · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> nueva línea
        </p>
        <p
          id={countId}
          className={cn(
            "text-caption tabular-nums",
            tooLong ? "text-danger" : "text-text-muted",
          )}
        >
          {length.toLocaleString("es-PY")} /{" "}
          {MESSAGE_MAX_LENGTH.toLocaleString("es-PY")}
        </p>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          className="ml-auto disabled:cursor-wait disabled:opacity-70"
        >
          {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      <p
        id={noticeId}
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
    </form>
  );
}
