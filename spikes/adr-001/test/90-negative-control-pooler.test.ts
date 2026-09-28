import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { verifiedClaimsFor } from "./support/claims";
import { connectionIdentity, openSql } from "./support/db";
import { env, isE1, isLoopbackUrl } from "./support/env";

/*
 * OBSERVACIONAL, SOLO E1 LOCAL (pooler en 127.0.0.1). Corre último porque
 * contamina a propósito backends del pooler local.
 *
 * Pregunta: ¿el pooler (Supavisor, modo transacción) limpia el estado de
 * SESIÓN entre clientes? Se fija rol + claims con set_config(..., false) y se
 * observa si otras conexiones de cliente lo ven. No afirma un resultado: lo
 * registra. La seguridad de la arquitectura NO depende de esto (usa LOCAL).
 *
 * Nunca se ejecuta contra un host no-loopback (E2/staging).
 */

const fixtures = inject("fixtures");
const url = env.runtimePoolerUrl;
const allowed = isE1 && url !== undefined && isLoopbackUrl(url);

describe.runIf(allowed)(
  "control negativo de sesión vía pooler local (observacional)",
  () => {
    const polluter = openSql(url ?? "", "negative-pooler-polluter", 1);
    const observer = openSql(url ?? "", "negative-pooler-observer", 5);
    let claimsJson = "";

    beforeAll(async () => {
      claimsJson = JSON.stringify(await verifiedClaimsFor(fixtures.users.uA));
    });
    afterAll(async () => {
      // Limpieza best-effort de los backends contaminados.
      for (let i = 0; i < 40; i += 1) {
        await observer.unsafe("reset role").catch(() => undefined);
        await observer`select set_config('request.jwt.claims', '', false)`.catch(
          () => undefined,
        );
      }
      await polluter.end({ timeout: 5 });
      await observer.end({ timeout: 5 });
    });

    it("registra si la contaminación de sesión cruza entre clientes del pooler", async () => {
      await polluter.begin(
        (tx) => tx`select set_config('role', 'authenticated', false),
                        set_config('request.jwt.claims', ${claimsJson}, false)`,
      );
      const samePolluter = await connectionIdentity(polluter);
      const seenByOthers: {
        currentUser: string;
        hasClaims: boolean;
        pid: number;
      }[] = [];
      for (let i = 0; i < 30; i += 1) {
        const identity = await connectionIdentity(observer);
        seenByOthers.push({
          currentUser: identity.currentUser,
          hasClaims: identity.claims.includes(fixtures.users.uA.id),
          pid: identity.pid,
        });
      }
      const contaminatedObservations = seenByOthers.filter(
        (o) => o.currentUser !== "app_runtime" || o.hasClaims,
      ).length;
      const report = {
        polluterNextStatement: {
          currentUser: samePolluter.currentUser,
          hasClaims: samePolluter.claims.includes(fixtures.users.uA.id),
        },
        observerSamples: seenByOthers.length,
        contaminatedObservations,
        distinctObserverBackends: new Set(seenByOthers.map((o) => o.pid)).size,
      };
      await mkdir(env.resultsDir, { recursive: true });
      await writeFile(
        join(env.resultsDir, "negative-control-pooler.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      console.info("[P3 control negativo pooler]", JSON.stringify(report));
      expect(report.observerSamples).toBe(30);
    });
  },
);
