import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Página /opportunities/[id] (H1.4, criterio U7): sin detalle (id inválido,
 * de otra organización o inexistente) responde notFound() y no renderiza
 * nada; con detalle, pasa el ViewModel del loader tal cual a la vista.
 */

const mocks = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  return {
    NotFoundSignal,
    getOpportunityDetail: vi.fn(),
    OpportunityDetailView: vi.fn(() => null),
  };
});

vi.mock("@/db/queries/opportunity-detail", () => ({
  getOpportunityDetail: mocks.getOpportunityDetail,
}));
vi.mock("@/components/opportunities/opportunity-detail", () => ({
  OpportunityDetailView: mocks.OpportunityDetailView,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new mocks.NotFoundSignal("notFound()");
  },
}));

const { default: OpportunityDetailPage } =
  await import("@/app/(app)/opportunities/[id]/page");

const ID = "30000000-0000-4000-8000-000000000001";

function render(id: string) {
  return OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  mocks.getOpportunityDetail.mockReset();
});

describe("/opportunities/[id]", () => {
  it("U7: sin detalle visible para el tenant activo, notFound()", async () => {
    mocks.getOpportunityDetail.mockResolvedValueOnce(null);

    await expect(render(ID)).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    expect(mocks.getOpportunityDetail).toHaveBeenCalledWith(ID);
  });

  it("el id de la ruta llega tal cual al loader, que lo valida", async () => {
    mocks.getOpportunityDetail.mockResolvedValueOnce(null);

    await expect(render("no-es-un-uuid")).rejects.toBeInstanceOf(
      mocks.NotFoundSignal,
    );
    expect(mocks.getOpportunityDetail).toHaveBeenCalledWith("no-es-un-uuid");
  });

  it("con detalle, la vista recibe el ViewModel del loader", async () => {
    const detail = {
      id: ID,
      contactName: "Ana Benítez",
      stage: "new",
      demand: { facts: [], legacy: null, empty: true },
      summary: { facts: {}, vehicle: null },
    };
    mocks.getOpportunityDetail.mockResolvedValueOnce(detail);

    const element = await render(ID);

    expect(element.type).toBe(mocks.OpportunityDetailView);
    expect(element.props).toEqual(detail);
  });
});
