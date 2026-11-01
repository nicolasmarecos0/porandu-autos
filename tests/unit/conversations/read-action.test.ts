import { beforeEach, describe, expect, it, vi } from "vitest";

import { markConversationRead } from "@/lib/conversations/read";

/*
 * Server Action markConversationRead() (Hito 12B, DEC-044 §2.7), sin base de
 * datos. Prueba el orden de la cadena (requireTenant() → validar el pedido
 * con Zod → marcar con ese mismo contexto → revalidar /conversations solo si
 * el cursor avanzó) y qué le llega a la escritura. La función de la base
 * (usuario, membership activa, conversación abierta, mensaje de ella,
 * GREATEST), RLS y el aislamiento se prueban contra PostgreSQL en
 * tests/db/conversation-reads.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  recordConversationRead: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/conversation-reads", () => ({
  recordConversationRead: mocks.recordConversationRead,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER_USER = "00000000-0000-4000-8000-00000000000b";
const CTX = Object.freeze({
  organizationId: ORG,
  userId: USER,
  marker: "tenant-context",
});
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "50000000-0000-4000-8000-000000000001";
const READ_UP_TO = new Date("2026-10-29T15:30:01.123Z");

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.recordConversationRead.mockReset();
  mocks.recordConversationRead.mockImplementation(async () => {
    mocks.calls.push("record");
    return { outcome: "marked", readUpTo: READ_UP_TO };
  });
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation(() => {
    mocks.calls.push("revalidatePath");
  });
});

describe("markConversationRead()", () => {
  it("requireTenant() → marca con ese contexto → revalida /conversations", async () => {
    const state = await markConversationRead({
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });

    expect(state).toEqual({ status: "marked" });
    expect(mocks.calls).toEqual(["requireTenant", "record", "revalidatePath"]);
    expect(mocks.recordConversationRead).toHaveBeenCalledWith(CTX, {
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/conversations",
    );
  });

  it("solo la conversación y el mensaje salen del pedido: la organización, el usuario y el cursor nunca", async () => {
    await markConversationRead({
      conversationId: CONVERSATION.toUpperCase(),
      upToMessageId: ` ${MESSAGE} `,
      organizationId: OTHER_ORG,
      userId: OTHER_USER,
      readUpTo: "2099-01-01T00:00:00Z",
    });

    const [ctx, request] = mocks.recordConversationRead.mock.calls[0] ?? [];
    expect(ctx).toBe(CTX);
    expect(request).toEqual({
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });
    expect(JSON.stringify(request)).not.toContain(OTHER_ORG);
    expect(JSON.stringify(request)).not.toContain(OTHER_USER);
    expect(JSON.stringify(request)).not.toContain("2099");
  });

  it.each([
    ["un id que no es UUID", { conversationId: "x", upToMessageId: MESSAGE }],
    ["sin mensaje", { conversationId: CONVERSATION }],
    ["un texto", "not an object"],
    ["null", null],
    ["un arreglo", [CONVERSATION, MESSAGE]],
  ])(
    "un pedido inválido (%s) se ignora sin error y no llega a la base",
    async (_, input) => {
      const state = await markConversationRead(input);

      expect(state).toEqual({ status: "ignored" });
      expect(mocks.calls).toEqual(["requireTenant"]);
      expect(mocks.recordConversationRead).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("si el cursor ya estaba ahí o más adelante, no hay nada que refrescar", async () => {
    mocks.recordConversationRead.mockResolvedValueOnce({
      outcome: "unchanged",
      readUpTo: READ_UP_TO,
    });

    const state = await markConversationRead({
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });

    expect(state).toEqual({ status: "unchanged" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una conversación cerrada, de otra organización o con un mensaje ajeno se ignora, sin distinguir", async () => {
    mocks.recordConversationRead.mockResolvedValueOnce({
      outcome: "not_found",
    });

    const state = await markConversationRead({
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });

    expect(state).toEqual({ status: "ignored" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una falla inesperada no expone la base y registra solo el tipo, el SQLSTATE y la constraint", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recordConversationRead.mockRejectedValueOnce(
      Object.assign(new Error(`Failed query: select ${MESSAGE}`), {
        cause: { code: "42501", constraint_name: undefined },
      }),
    );

    const state = await markConversationRead({
      conversationId: CONVERSATION,
      upToMessageId: MESSAGE,
    });

    expect(state).toEqual({ status: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "[conversations] mark read failed",
      { name: "Error", code: "42501", constraint_name: undefined },
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(MESSAGE);
    error.mockRestore();
  });

  it("sin sesión o sin membership activa, requireTenant() corta antes de leer el pedido", async () => {
    mocks.requireTenant.mockImplementationOnce(async () => {
      throw new RedirectSignal("/login");
    });

    await expect(
      markConversationRead({
        conversationId: CONVERSATION,
        upToMessageId: MESSAGE,
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.recordConversationRead).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
