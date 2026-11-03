import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Página /cockpit/metrics (propuesta DEC-050): le pasa los `searchParams`
 * tal cual al loader tenant-scoped (que resuelve el período, fija `now` y
 * pide su propio contexto) y el ViewModel tal cual a la vista. La página no
 * valida el período ni conoce Drizzle.
 */

const mocks = vi.hoisted(() => ({
  getCockpitMetrics: vi.fn(),
  CockpitMetricsView: vi.fn(() => null),
}));

vi.mock("@/db/queries/cockpit-metrics", () => ({
  getCockpitMetrics: mocks.getCockpitMetrics,
}));
vi.mock("@/components/cockpit/metrics/metrics-view", () => ({
  CockpitMetricsView: mocks.CockpitMetricsView,
}));

const { default: CockpitMetricsPage, metadata } =
  await import("@/app/(app)/cockpit/metrics/page");

const METRICS = Object.freeze({ marker: "metrics" });

function props(searchParams: Record<string, string | string[] | undefined>) {
  return {
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  };
}

beforeEach(() => {
  mocks.getCockpitMetrics.mockReset();
  mocks.CockpitMetricsView.mockClear();
});

describe("/cockpit/metrics", () => {
  it("pasa las métricas del loader a la vista, con su título", async () => {
    mocks.getCockpitMetrics.mockResolvedValueOnce(METRICS);

    const element = await CockpitMetricsPage(props({}));

    expect(mocks.getCockpitMetrics).toHaveBeenCalledWith({});
    expect(element.type).toBe(mocks.CockpitMetricsView);
    expect(element.props).toEqual({
      title: "Métricas del salón",
      metrics: METRICS,
    });
    expect(metadata).toEqual({ title: "Métricas del salón" });
  });

  it("le pasa el período de la URL al loader sin interpretarlo (input no confiable)", async () => {
    mocks.getCockpitMetrics.mockResolvedValueOnce(METRICS);
    const searchParams = { period: ["7d", "90d"], range: "year" };

    await CockpitMetricsPage(props(searchParams));

    expect(mocks.getCockpitMetrics).toHaveBeenCalledTimes(1);
    expect(mocks.getCockpitMetrics).toHaveBeenCalledWith(searchParams);
  });

  it("si el loader redirige (sin sesión, sin acceso), no renderiza", async () => {
    mocks.getCockpitMetrics.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(CockpitMetricsPage(props({}))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.CockpitMetricsView).not.toHaveBeenCalled();
  });
});
