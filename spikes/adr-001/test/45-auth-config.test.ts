import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, inject, it } from "vitest";
import { env, usesSupabase } from "./support/env";

/*
 * Hipótesis D8 · signup público deshabilitado, login con email + password
 * habilitado. El login ya lo ejercita el global setup (los 5 usuarios entran
 * con password); acá se verifica que un visitante con la publishable key NO
 * pueda auto-registrarse. Si el signup estuviera abierto, el usuario creado
 * lleva la marca `@adr001.test` y lo borra la limpieza de e2.
 */

const fixtures = inject("fixtures");

describe.runIf(usesSupabase)("D8 · configuración de Auth", () => {
  it("signup público deshabilitado: signUp con la publishable key falla", async () => {
    if (!env.supabaseUrl || !env.publishableKey) {
      throw new Error("requiere Supabase real (e1/e2)");
    }
    const visitor = createClient(env.supabaseUrl, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await visitor.auth.signUp({
      email: `signup-probe-${fixtures.meta.runId}@adr001.test`,
      password: randomBytes(18).toString("base64url"),
    });
    expect(error, JSON.stringify(data)).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("login con email + password habilitado: los usuarios sintéticos obtuvieron sesión", () => {
    for (const user of Object.values(fixtures.users)) {
      expect(user.accessToken.split(".")).toHaveLength(3);
    }
  });
});
