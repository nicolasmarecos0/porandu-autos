import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Página /intelligence (Hito 5, DEC-037 §1; DEC-043 §2): le pasa los
 * `searchParams` tal cual al loader tenant-scoped (que resuelve el rango, fija
 * `now` y pide su propio contexto) y el ViewModel tal cual a la vista. La
 * página no valida el rango ni conoce Drizzle.
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

function props(searchParams: Record<string, string | string[] | undefined>) {
  return {
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  };
}

beforeEach(() => {
  mocks.getExecutiveDashboard.mockReset();
  mocks.ExecutiveDashboardView.mockClear();
});

describe("/intelligence", () => {
  it("pasa el dashboard del loader a la vista, con el título de la navegación", async () => {
    mocks.getExecutiveDashboard.mockResolvedValueOnce(DASHBOARD);

    const element = await IntelligencePage(props({}));

    expect(mocks.getExecutiveDashboard).toHaveBeenCalledWith({});
    expect(element.type).toBe(mocks.ExecutiveDashboardView);
    expect(element.props).toEqual({
      title: "Inteligencia",
      dashboard: DASHBOARD,
    });
    expect(metadata).toEqual({ title: "Inteligencia" });
  });

  it("le pasa el rango de la URL al loader sin interpretarlo (input no confiable)", async () => {
    mocks.getExecutiveDashboard.mockResolvedValueOnce(DASHBOARD);
    const searchParams = {
      range: "custom",
      from: "2026-10-01",
      to: ["2026-10-15", "2026-10-20"],
    };

    await IntelligencePage(props(searchParams));

    expect(mocks.getExecutiveDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getExecutiveDashboard).toHaveBeenCalledWith(searchParams);
  });

  it("si el loader redirige (sin sesión, sin acceso), no renderiza", async () => {
    mocks.getExecutiveDashboard.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT"),
    );

    await expect(IntelligencePage(props({}))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.ExecutiveDashboardView).not.toHaveBeenCalled();
  });
});
