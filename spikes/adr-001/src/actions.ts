import { tenantProbe } from "./probe-schema";
import type { RuntimeDb } from "./runtime";
import { withTenant, type TenantContext } from "./tenant";

/*
 * Patrón de mutación previsto para Server Actions, sin Next.
 * El input del cliente NUNCA trae organization_id: la org sale del
 * TenantContext validado. Un campo desconocido se rechaza (no se ignora).
 *
 * El validador a mano reemplaza a `z.object({...}).strict()` solo porque Zod
 * no está autorizado como dependencia del spike.
 */

export class InputValidationError extends Error {
  override name = "InputValidationError";
}

export type CreateProbeInput = { readonly label: string };

const ALLOWED_KEYS = new Set(["label"]);

export function parseCreateProbeInput(input: unknown): CreateProbeInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InputValidationError("input inválido");
  }
  const record = input as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new InputValidationError(
      `campos no permitidos: ${unknownKeys.join(", ")}`,
    );
  }
  const label = record.label;
  if (typeof label !== "string" || label.length === 0 || label.length > 200) {
    throw new InputValidationError("label inválido");
  }
  return { label };
}

export async function createProbe(
  runtime: RuntimeDb,
  ctx: TenantContext,
  input: unknown,
): Promise<{ id: string; organizationId: string }> {
  const parsed = parseCreateProbeInput(input);
  const [row] = await withTenant(runtime, ctx, (tx) =>
    tx
      .insert(tenantProbe)
      .values({ organizationId: ctx.organizationId, label: parsed.label })
      .returning({
        id: tenantProbe.id,
        organizationId: tenantProbe.organizationId,
      }),
  );
  if (!row) throw new Error("insert sin fila");
  return row;
}
