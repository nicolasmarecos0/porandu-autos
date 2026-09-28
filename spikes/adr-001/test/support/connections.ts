import { env, isE2 } from "./env";

/** Conexiones de runtime (`app_runtime`) sobre las que se repite la matriz. */
export type RuntimeConnection = { readonly name: string; readonly url: string };

export const runtimeConnections: readonly RuntimeConnection[] = [
  // e2 no tiene conexión directa (sin IPv6 en GitHub Actions): pooler en modo sesión.
  { name: isE2 ? "sesion" : "directa", url: env.runtimeUrl },
  ...(env.runtimePoolerUrl
    ? [{ name: "pooler", url: env.runtimePoolerUrl }]
    : []),
];

/** En e1/e2 la arquitectura objetivo es app_runtime → pooler; en e0 no hay pooler. */
export const primaryRuntimeUrl = env.runtimePoolerUrl ?? env.runtimeUrl;
