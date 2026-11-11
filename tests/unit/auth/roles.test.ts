import { describe, expect, it } from "vitest";

import { MEMBER_ROLES } from "@/domains/team/members";
import {
  authorize,
  can,
  CAPABILITIES,
  CAPABILITY_REQUIREMENTS,
  MANAGEMENT_ROLES,
  rolesFor,
  UNAUTHORIZED_ROLE,
  unauthorizedRole,
  unauthorizedRoleMessage,
} from "@/lib/auth/roles";

/*
 * Control de roles (Hito 22, DEC-054 §1): la gerencia (`admin`) aprueba
 * tomas, tasa, ve la sección financiera, cambia precios, anula entregas y ve
 * las Métricas del salón; el equipo de ventas (`seller`), no.
 */

describe("lib/auth/roles", () => {
  it("la gerencia es el rol admin, uno de los roles de la membership", () => {
    expect(MANAGEMENT_ROLES).toEqual(["admin"]);
    for (const role of MANAGEMENT_ROLES) expect(MEMBER_ROLES).toContain(role);
  });

  it.each(CAPABILITIES)("%s: admin sí, seller no", (capability) => {
    expect(can("admin", capability)).toBe(true);
    expect(can("seller", capability)).toBe(false);
    expect(rolesFor(capability)).toEqual(["admin"]);
  });

  it("un rol desconocido (forzado) no tiene ninguna capacidad: falla cerrado", () => {
    for (const capability of CAPABILITIES) {
      expect(can("manager" as never, capability)).toBe(false);
    }
  });

  it("authorize() devuelve null o el error estructurado UNAUTHORIZED_ROLE", () => {
    expect(authorize("admin", "trade_in.approve")).toBeNull();
    expect(authorize("seller", "trade_in.approve")).toEqual({
      status: "unauthorized_role",
      code: UNAUTHORIZED_ROLE,
      capability: "trade_in.approve",
    });
    expect(UNAUTHORIZED_ROLE).toBe("UNAUTHORIZED_ROLE");
    expect(unauthorizedRole("vehicle.edit_price")).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "vehicle.edit_price",
    });
  });

  it("cada capacidad dice, en es-PY, quién la tiene; el aviso agrega que no se guardó nada", () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_REQUIREMENTS[capability]).toMatch(/administrador/);
    }
    expect(unauthorizedRoleMessage("delivery.cancel")).toBe(
      "Solo un administrador (gerente) anula una entrega. No se guardó nada.",
    );
  });
});
