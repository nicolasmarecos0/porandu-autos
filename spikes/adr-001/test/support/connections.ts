import { env } from "./env";

/** Conexiones de runtime (`app_runtime`) sobre las que se repite la matriz. */
export type RuntimeConnection = { readonly name: string; readonly url: string };

export const runtimeConnections: readonly RuntimeConnection[] = [
  { name: "directa", url: env.runtimeUrl },
  ...(env.runtimePoolerUrl
    ? [{ name: "pooler", url: env.runtimePoolerUrl }]
    : []),
];

/** En e1 la arquitectura objetivo es app_runtime → pooler; en e0 no hay pooler. */
export const primaryRuntimeUrl = env.runtimePoolerUrl ?? env.runtimeUrl;
