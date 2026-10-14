import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Página /intelligence (Hito 5, DEC-037 §1): deja de ser el empty state de
 * B1. Llama al loader tenant-scoped sin argumentos (el loader fija `now` y
 * pide su propio contexto) y le pasa el ViewModel tal cual a la vista.
 */

const mocks = vi.hoisted(() => ({
  getExecutiveDashboard: vi.fn(),
  ExecutiveDashboardView: vi.fn(() => null),
}));

vi.mock("@/db/queries/dashboard", () => ({
  getExecutiveDashboard: mocks.getExecutiveDashboard,
}));
vi.mock("@/components/dashboard/executive-dashboard", () => ({
  ExecutiveDashboardView: mocks.ExecutiveDashboardView,
}));

const { default: IntelligencePage, metadata } =
  await import("@/app/(app)/intelligence/page");

const DASHBOARD = Object.freeze({ marker: "dashboard" });

beforeEach(() => {
  mocks.getExecutiveDashboard.mockReset();
});

describe("/intelligence", () => {
  it("pasa el dashboard del loader a la vista, con el título de la navegación", async () => {
    mocks.getExecutiveDashboard.mockResolvedValueOnce(DASHBOARD);

    const element = await IntelligencePage();

    expect(mocks.getExecutiveDashboard).toHaveBeenCalledWith();
    expect(element.type).toBe(mocks.ExecutiveDashboardView);
    expect(element.props).toEqual({
      title: "Inteligencia",
      dashboard: DASHBOARD,
    });
    expect(metadata).toEqual({ title: "Inteligencia" });
  });

  it("si el loader redirige (sin sesión, sin acceso), no renderiza", async () => {
    mocks.getExecutiveDashboard.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT"),
    );

    await expect(IntelligencePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.ExecutiveDashboardView).not.toHaveBeenCalled();
  });
});
