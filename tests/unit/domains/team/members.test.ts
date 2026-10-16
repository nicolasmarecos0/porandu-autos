import { describe, expect, it } from "vitest";

import { membershipRole } from "@/db/schema/memberships";
import {
  buildTeamView,
  canEditOrganization,
  canManageMember,
  canManageTeam,
  EMAIL_MAX_LENGTH,
  INVITATION_FIELDS,
  MEMBER_FIELDS,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  memberInitials,
  normalizeEmail,
  parseInvitation,
  parseMemberRole,
  type TeamMemberRow,
} from "@/domains/team/members";

/*
 * Equipo del concesionario (Hito 6, DEC-038 §5 y §7): roles, reglas de
 * acceso (RBAC) y validación con Zod de invitaciones y cambios de rol. La
 * autorización real la imponen las acciones y la base
 * (tests/unit/settings/actions.test.ts y tests/db/team-settings.test.ts).
 */

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const SELLER = "00000000-0000-4000-8000-00000000000c";

describe("roles", () => {
  it("admin y seller, como el enum membership_role de la base", () => {
    expect(MEMBER_ROLES).toEqual(["admin", "seller"]);
    expect([...membershipRole.enumValues]).toEqual([...MEMBER_ROLES]);
  });

  it("copy es-PY de cada rol", () => {
    expect(MEMBER_ROLE_LABELS).toEqual({
      admin: "Administrador",
      seller: "Vendedor",
    });
  });

  it.each([
    ["admin", "admin"],
    [" seller ", "seller"],
  ])("parseMemberRole(%j) → %s", (raw, role) => {
    expect(parseMemberRole(raw)).toBe(role);
  });

  it.each(["", "owner", "Admin", "ADMIN", "vendedor", "superadmin"])(
    "parseMemberRole(%j) → null (fuera de la lista)",
    (raw) => {
      expect(parseMemberRole(raw)).toBeNull();
    },
  );
});

describe("RBAC (DEC-038 §5)", () => {
  it("solo un admin gestiona el equipo y edita la organización", () => {
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("seller")).toBe(false);
    expect(canEditOrganization("admin")).toBe(true);
    expect(canEditOrganization("seller")).toBe(false);
  });

  it("un admin gestiona a otro miembro, nunca a sí mismo", () => {
    const admin = { userId: ADMIN, role: "admin" as const };
    expect(canManageMember(admin, { userId: SELLER })).toBe(true);
    expect(canManageMember(admin, { userId: ADMIN })).toBe(false);
  });

  it("un seller no gestiona a nadie, tampoco a sí mismo", () => {
    const seller = { userId: SELLER, role: "seller" as const };
    expect(canManageMember(seller, { userId: ADMIN })).toBe(false);
    expect(canManageMember(seller, { userId: SELLER })).toBe(false);
  });
});

describe("parseInvitation (Zod)", () => {
  it("los pedidos solo traen sus campos (la organización sale del contexto)", () => {
    expect(Object.values(INVITATION_FIELDS)).toEqual(["email", "role"]);
    expect(Object.values(MEMBER_FIELDS)).toEqual(["membershipId", "role"]);
  });

  it("normaliza el email: recortado y en minúsculas", () => {
    expect(normalizeEmail("  Ana.Perez@Concesionario.COM.py ")).toBe(
      "ana.perez@concesionario.com.py",
    );
    expect(
      parseInvitation({ email: " ANA@Org.test ", role: " admin " }),
    ).toEqual({
      ok: true,
      invitation: { email: "ana@org.test", role: "admin" },
    });
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["ana", "invalid_email"],
    ["ana@", "invalid_email"],
    ["@org.test", "invalid_email"],
    ["ana@org", "invalid_email"],
    ["ana perez@org.test", "invalid_email"],
    ["ana@org.test,beto@org.test", "invalid_email"],
  ])("email %j → %s", (email, error) => {
    expect(parseInvitation({ email, role: "seller" })).toEqual({
      ok: false,
      errors: { email: error },
    });
  });

  it(`el email admite hasta ${EMAIL_MAX_LENGTH} caracteres`, () => {
    const long = `${"a".repeat(EMAIL_MAX_LENGTH - "@org.test".length + 1)}@org.test`;
    expect(parseInvitation({ email: long, role: "seller" })).toEqual({
      ok: false,
      errors: { email: "too_long" },
    });
  });

  it.each([
    ["", "required"],
    ["owner", "invalid_option"],
    ["Administrador", "invalid_option"],
  ])("rol %j → %s", (role, error) => {
    expect(parseInvitation({ email: "ana@org.test", role })).toEqual({
      ok: false,
      errors: { role: error },
    });
  });

  it("devuelve el primer error de cada campo inválido", () => {
    expect(parseInvitation({ email: "no", role: "root" })).toEqual({
      ok: false,
      errors: { email: "invalid_email", role: "invalid_option" },
    });
  });
});

describe("buildTeamView", () => {
  const row = (overrides: Partial<TeamMemberRow>): TeamMemberRow => ({
    membershipId: "20000000-0000-4000-8000-000000000001",
    userId: SELLER,
    fullName: "Carla Vendedora",
    email: "carla@org.test",
    role: "seller",
    joinedAt: new Date("2026-10-01T12:00:00Z"),
    ...overrides,
  });

  const rows = [
    row({
      membershipId: "20000000-0000-4000-8000-000000000003",
      userId: "00000000-0000-4000-8000-00000000000e",
      fullName: null,
      email: "zoe@org.test",
    }),
    row({}),
    row({
      membershipId: "20000000-0000-4000-8000-000000000002",
      userId: ADMIN,
      fullName: "Ana Admin",
      email: "ana@org.test",
      role: "admin",
    }),
  ];

  it("admins primero, después por nombre; marca al viewer y qué puede gestionar", () => {
    const view = buildTeamView(rows, { userId: ADMIN, role: "admin" });
    expect(
      view.members.map(({ displayName, isViewer, manageable }) => ({
        displayName,
        isViewer,
        manageable,
      })),
    ).toEqual([
      { displayName: "Ana Admin", isViewer: true, manageable: false },
      { displayName: "Carla Vendedora", isViewer: false, manageable: true },
      { displayName: "zoe@org.test", isViewer: false, manageable: true },
    ]);
    expect(view).toMatchObject({
      viewerRole: "admin",
      canInvite: true,
      adminCount: 1,
    });
  });

  it("para un seller, la misma lista sin nada gestionable ni invitación", () => {
    const view = buildTeamView(rows, { userId: SELLER, role: "seller" });
    expect(view.canInvite).toBe(false);
    expect(view.members.some((member) => member.manageable)).toBe(false);
    expect(view.members.find((member) => member.isViewer)?.displayName).toBe(
      "Carla Vendedora",
    );
  });

  it("sin nombre ni email, un genérico", () => {
    const view = buildTeamView([row({ fullName: " ", email: null })], {
      userId: ADMIN,
      role: "admin",
    });
    expect(view.members[0]?.displayName).toBe("Miembro sin nombre");
  });

  it("iniciales de hasta dos letras", () => {
    expect(memberInitials("Ana Admin")).toBe("AA");
    expect(memberInitials("carla")).toBe("C");
    expect(memberInitials("zoe.perez@org.test")).toBe("ZP");
    expect(memberInitials("Ñandu Ibáñez Solís")).toBe("ÑI");
  });
});
