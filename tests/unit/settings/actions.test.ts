import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  inviteMember,
  removeMember,
  updateMemberRole,
  updateOrganization,
} from "@/lib/settings/actions";

/*
 * Server Actions de Configuración (Hito 6, DEC-038 §5), sin base de datos.
 * Prueba la cadena (requireTenant() → rol admin → leer y validar el pedido
 * con Zod → escritura con ese mismo contexto → revalidar), que un seller
 * no llega nunca a la capa de escritura y qué le llega a la escritura. RLS,
 * los triggers de guarda y el aislamiento se prueban contra PostgreSQL en
 * tests/db/team-settings.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  updateOrganizationSettings: vi.fn(),
  inviteMemberByEmail: vi.fn(),
  changeMemberRole: vi.fn(),
  deactivateMember: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/settings-write", () => ({
  updateOrganizationSettings: mocks.updateOrganizationSettings,
  inviteMemberByEmail: mocks.inviteMemberByEmail,
  changeMemberRole: mocks.changeMemberRole,
  deactivateMember: mocks.deactivateMember,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-00000000000a";
const MEMBERSHIP = "20000000-0000-4000-8000-000000000001";

function context(role: "admin" | "seller") {
  return Object.freeze({ organizationId: ORG, userId: USER, role });
}

let ctx = context("admin");

const WRITES = [
  "updateOrganizationSettings",
  "inviteMemberByEmail",
  "changeMemberRole",
  "deactivateMember",
] as const;

beforeEach(() => {
  ctx = context("admin");
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return ctx;
  });
  for (const name of WRITES) {
    mocks[name].mockReset();
    mocks[name].mockImplementation(async () => {
      mocks.calls.push(name);
      return name === "inviteMemberByEmail"
        ? { outcome: "added", membershipId: MEMBERSHIP }
        : { outcome: "updated" };
    });
  }
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation(() => {
    mocks.calls.push("revalidatePath");
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const ORGANIZATION = { name: "Porandú Autos", defaultCurrency: "USD" };
const INVITATION = { email: "fabi@nuevo.test", role: "seller" };

describe("RBAC: un seller nunca llega a la capa de escritura", () => {
  it.each([
    ["updateOrganization", () => updateOrganization(null, form(ORGANIZATION))],
    ["inviteMember", () => inviteMember(null, form(INVITATION))],
    [
      "updateMemberRole",
      () =>
        updateMemberRole(
          null,
          form({ membershipId: MEMBERSHIP, role: "admin" }),
        ),
    ],
    [
      "removeMember",
      () => removeMember(null, form({ membershipId: MEMBERSHIP })),
    ],
  ])("%s → forbidden, sin escribir ni revalidar", async (_name, run) => {
    ctx = context("seller");
    expect(await run()).toEqual({ status: "forbidden" });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it("el rol sale del contexto: un role=admin en el pedido no cambia nada", async () => {
    ctx = context("seller");
    expect(
      await inviteMember(
        null,
        form({ ...INVITATION, role: "admin", viewerRole: "admin" }),
      ),
    ).toEqual({ status: "forbidden" });
    expect(mocks.inviteMemberByEmail).not.toHaveBeenCalled();
  });
});

describe("updateOrganization()", () => {
  it("requireTenant() → escritura con ese contexto y lo normalizado → revalidar /settings", async () => {
    const state = await updateOrganization(
      null,
      form({
        name: "  Porandú   Autos ",
        defaultCurrency: "USD",
        organizationId: OTHER_ORG,
      }),
    );
    expect(mocks.calls).toEqual([
      "requireTenant",
      "updateOrganizationSettings",
      "revalidatePath",
    ]);
    // La organización del pedido se ignora: la escritura usa el contexto.
    expect(mocks.updateOrganizationSettings).toHaveBeenCalledWith(ctx, {
      name: "Porandú Autos",
      defaultCurrency: "USD",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(state).toEqual({
      status: "saved",
      settings: { name: "Porandú Autos", defaultCurrency: "USD" },
    });
  });

  it("inválido: no escribe y devuelve lo cargado con los errores", async () => {
    expect(
      await updateOrganization(null, form({ name: "", defaultCurrency: "X" })),
    ).toEqual({
      status: "invalid",
      errors: { name: "required", defaultCurrency: "invalid_option" },
      values: { name: "", defaultCurrency: "X" },
    });
    expect(mocks.updateOrganizationSettings).not.toHaveBeenCalled();
  });

  it("si RLS no deja editar, forbidden y no revalida", async () => {
    mocks.updateOrganizationSettings.mockResolvedValueOnce({
      outcome: "forbidden",
    });
    expect(await updateOrganization(null, form(ORGANIZATION))).toEqual({
      status: "forbidden",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una falla inesperada no expone detalles y devuelve lo cargado", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateOrganizationSettings.mockRejectedValueOnce(
      Object.assign(new Error("boom: SELECT secret"), {
        cause: { code: "XX000", constraint_name: undefined },
      }),
    );
    expect(await updateOrganization(null, form(ORGANIZATION))).toEqual({
      status: "failed",
      values: ORGANIZATION,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    error.mockRestore();
  });
});

describe("inviteMember()", () => {
  it.each([
    [{ outcome: "added", membershipId: MEMBERSHIP }, "added", true],
    [{ outcome: "reactivated", membershipId: MEMBERSHIP }, "reactivated", true],
    [{ outcome: "already_member" }, "already_member", false],
  ] as const)(
    "%j → %s (revalida /settings/team: %s)",
    async (outcome, status, revalidates) => {
      mocks.inviteMemberByEmail.mockResolvedValueOnce(outcome);
      const state = await inviteMember(
        null,
        form({ email: " FABI@Nuevo.test ", role: "admin" }),
      );
      expect(mocks.inviteMemberByEmail).toHaveBeenCalledWith(ctx, {
        email: "fabi@nuevo.test",
        role: "admin",
      });
      expect(state).toEqual({
        status,
        invitation: { email: "fabi@nuevo.test", role: "admin" },
      });
      expect(mocks.revalidatePath.mock.calls).toEqual(
        revalidates ? [["/settings/team"]] : [],
      );
    },
  );

  it("sin cuenta: no_account con lo cargado", async () => {
    mocks.inviteMemberByEmail.mockResolvedValueOnce({ outcome: "no_account" });
    expect(await inviteMember(null, form(INVITATION))).toEqual({
      status: "no_account",
      values: INVITATION,
    });
  });

  it("inválido: no escribe", async () => {
    expect(
      await inviteMember(null, form({ email: "x", role: "owner" })),
    ).toEqual({
      status: "invalid",
      errors: { email: "invalid_email", role: "invalid_option" },
      values: { email: "x", role: "owner" },
    });
    expect(mocks.inviteMemberByEmail).not.toHaveBeenCalled();
  });
});

describe("updateMemberRole() y removeMember()", () => {
  it("cambia el rol con el id normalizado y el contexto", async () => {
    expect(
      await updateMemberRole(
        null,
        form({ membershipId: MEMBERSHIP.toUpperCase(), role: " seller " }),
      ),
    ).toEqual({ status: "updated" });
    expect(mocks.changeMemberRole).toHaveBeenCalledWith(
      ctx,
      MEMBERSHIP,
      "seller",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/team");
  });

  it("revoca con el contexto", async () => {
    expect(
      await removeMember(null, form({ membershipId: MEMBERSHIP })),
    ).toEqual({ status: "removed" });
    expect(mocks.deactivateMember).toHaveBeenCalledWith(ctx, MEMBERSHIP);
  });

  it("un id malformado es not_found sin llegar a la base", async () => {
    expect(
      await removeMember(null, form({ membershipId: "1 OR 1=1" })),
    ).toEqual({ status: "not_found" });
    expect(
      await updateMemberRole(null, form({ membershipId: "", role: "admin" })),
    ).toEqual({ status: "not_found" });
    expect(mocks.calls).not.toContain("deactivateMember");
    expect(mocks.calls).not.toContain("changeMemberRole");
  });

  it("un rol fuera de la lista es invalid sin llegar a la base", async () => {
    expect(
      await updateMemberRole(
        null,
        form({ membershipId: MEMBERSHIP, role: "owner" }),
      ),
    ).toEqual({ status: "invalid" });
    expect(mocks.changeMemberRole).not.toHaveBeenCalled();
  });

  it.each(["not_found", "self", "last_admin"] as const)(
    "el resultado %s de la base vuelve tal cual y no revalida",
    async (outcome) => {
      mocks.deactivateMember.mockResolvedValueOnce({ outcome });
      expect(
        await removeMember(null, form({ membershipId: MEMBERSHIP })),
      ).toEqual({ status: outcome });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("una falla inesperada es failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.changeMemberRole.mockRejectedValueOnce(new Error("boom"));
    expect(
      await updateMemberRole(
        null,
        form({ membershipId: MEMBERSHIP, role: "admin" }),
      ),
    ).toEqual({ status: "failed" });
    error.mockRestore();
  });
});
