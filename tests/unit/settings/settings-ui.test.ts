import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OrganizationSettingsPanel } from "@/components/settings/organization-form";
import { TeamPanel } from "@/components/settings/team-panel";
import { buildTeamView, type TeamMemberRow } from "@/domains/team/members";

/*
 * UI de Configuración (Hito 6, DEC-038 §8), renderizada en el servidor sin
 * DOM: qué ve un admin y qué ve un seller. Ocultar una acción es UX, no la
 * barrera (las Server Actions y la base se prueban en
 * tests/unit/settings/actions.test.ts y tests/db/team-settings.test.ts).
 */

vi.mock("@/lib/settings/actions", () => ({
  updateOrganization: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const SELLER = "00000000-0000-4000-8000-00000000000c";

const ROWS: TeamMemberRow[] = [
  {
    membershipId: "20000000-0000-4000-8000-000000000001",
    userId: ADMIN,
    fullName: "Ana Admin",
    email: "ana@org.test",
    role: "admin",
    joinedAt: new Date("2026-10-01T12:00:00Z"),
  },
  {
    membershipId: "20000000-0000-4000-8000-000000000002",
    userId: SELLER,
    fullName: "Carla Vendedora",
    email: "carla@org.test",
    role: "seller",
    joinedAt: new Date("2026-10-02T12:00:00Z"),
  },
];

describe("Equipo", () => {
  it("admin: invita y tiene menú de acciones para los demás, nunca para sí mismo", () => {
    const html = renderToStaticMarkup(
      createElement(TeamPanel, {
        team: buildTeamView(ROWS, { userId: ADMIN, role: "admin" }),
      }),
    );
    expect(html).toContain("Invitar miembro");
    expect(html).toContain('aria-label="Acciones para Carla Vendedora"');
    expect(html).not.toContain('aria-label="Acciones para Ana Admin"');
    expect(html).toContain("(vos)");
    expect(html).toContain("Administrador");
    expect(html).toContain("Vendedor");
    expect(html).toContain("carla@org.test");
    expect(html).not.toContain("Solo lectura");
  });

  it("seller: la misma lista, de solo lectura, sin invitar ni acciones", () => {
    const html = renderToStaticMarkup(
      createElement(TeamPanel, {
        team: buildTeamView(ROWS, { userId: SELLER, role: "seller" }),
      }),
    );
    expect(html).toContain("Ana Admin");
    expect(html).toContain("Carla Vendedora");
    expect(html).not.toContain("Invitar miembro");
    expect(html).not.toContain("Acciones para");
    expect(html).toContain("Solo lectura");
    expect(html).toContain(
      "Solo un administrador puede invitar, cambiar roles o quitar accesos.",
    );
  });
});

describe("General", () => {
  it("admin: formulario con nombre y moneda por defecto", () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationSettingsPanel, {
        settings: {
          name: "Porandú Autos",
          defaultCurrency: "USD",
          canEdit: true,
        },
      }),
    );
    expect(html).toContain("<form");
    expect(html).toContain('name="name"');
    expect(html).toContain('value="Porandú Autos"');
    expect(html).toContain('name="defaultCurrency"');
    expect(html).toContain("Guardar cambios");
  });

  it("seller: los mismos datos de solo lectura, sin formulario", () => {
    const html = renderToStaticMarkup(
      createElement(OrganizationSettingsPanel, {
        settings: {
          name: "Porandú Autos",
          defaultCurrency: "USD",
          canEdit: false,
        },
      }),
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Guardar cambios");
    expect(html).toContain("Porandú Autos");
    expect(html).toContain("USD (dólares)");
    expect(html).toContain("Solo un administrador puede editar estos datos.");
  });
});
