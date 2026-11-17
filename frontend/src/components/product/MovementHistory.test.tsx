import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovementItem, MovementsPayload } from "../../api/types";
import MovementHistory from "./MovementHistory";

function movement(overrides: Partial<MovementItem> = {}): MovementItem {
  return {
    id: 1,
    source_key: "APONTAMENTOS:SERRA 01:CORTE:1",
    sequence: 0,
    movement_type: "consumo_vergalhao",
    process: "CORTE",
    next_process: "FORJA",
    material_lot_id: "LT-5121-002",
    production_lot_id: "LT-5121-002-P001",
    origin_type: "material",
    good_pieces: 1947,
    loss_pieces: 8,
    consumed_kg: 631.465,
    machine: "SERRA 01",
    operator_name: "Pedro",
    shift: "1",
    reason: null,
    occurred_at: "2026-09-03T00:00:00+00:00",
    recorded_at: "2026-09-04T17:26:43+00:00",
    ...overrides,
  };
}

function payload(items: MovementItem[], nextBeforeId: number | null = null): MovementsPayload {
  return {
    product_id: "placa-160",
    product_name: "Placa 160",
    items,
    summary: {
      total: items.length,
      first_occurred_at: "2026-08-28T00:00:00+00:00",
      last_occurred_at: "2026-09-04T00:00:00+00:00",
      last_recorded_at: "2026-09-04T17:26:43+00:00",
    },
    next_before_id: nextBeforeId,
    stale_reason: "",
  };
}

function mockFetch(...responses: MovementsPayload[]) {
  const fetchMock = vi.fn(async () => {
    const body = responses.shift() ?? payload([]);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("histórico de movimentações", () => {
  it("não consulta nada enquanto está recolhido", () => {
    // A consulta reconstrói a rastreabilidade no servidor e leva segundos:
    // não pode pesar na abertura da peça, que é o gesto do dia inteiro.
    const fetchMock = mockFetch(payload([movement()]));

    render(<MovementHistory productId="placa-160" productName="Placa 160" />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("carrega e lista as movimentações ao abrir", async () => {
    mockFetch(
      payload([
        movement(),
        movement({
          id: 2,
          movement_type: "etapa",
          process: "FORJA",
          good_pieces: 1830,
          consumed_kg: 0,
        }),
      ]),
    );

    render(<MovementHistory productId="placa-160" productName="Placa 160" />);
    await userEvent.click(screen.getByRole("button", { name: /Movimentações registradas/ }));

    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("Consumo de vergalhão")).toBeInTheDocument();
    expect(within(tabela).getByText("Passagem de etapa")).toBeInTheDocument();
    expect(within(tabela).getAllByText("LT-5121-002").length).toBeGreaterThan(0);
    expect(within(tabela).getByText("1.947")).toBeInTheDocument();
    expect(within(tabela).getByText("1.830")).toBeInTheDocument();
    // Etapa não consome vergalhão: travessão, nunca "0 kg".
    expect(within(tabela).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Fim do histórico registrado.")).toBeInTheDocument();
  });

  it("acumula as páginas seguintes em vez de trocar a lista", async () => {
    mockFetch(
      payload([movement({ id: 9 })], 9),
      payload([movement({ id: 8, process: "REBARBA" })]),
    );

    render(<MovementHistory productId="placa-160" productName="Placa 160" />);
    await userEvent.click(screen.getByRole("button", { name: /Movimentações registradas/ }));
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(3); // cabeçalho + 2 linhas
    });
  });

  it("informa a falha sem inventar histórico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "Banco fora." }), { status: 503 })),
    );

    render(<MovementHistory productId="placa-160" productName="Placa 160" />);
    await userEvent.click(screen.getByRole("button", { name: /Movimentações registradas/ }));

    expect(await screen.findByText("Histórico indisponível")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("avisa quando o registro pode estar atrasado, mas mostra o que tem", async () => {
    mockFetch({ ...payload([movement()]), stale_reason: "Histórico pode estar desatualizado: TOTVS indisponível" });

    render(<MovementHistory productId="placa-160" productName="Placa 160" />);
    await userEvent.click(screen.getByRole("button", { name: /Movimentações registradas/ }));

    expect(await screen.findByText(/pode estar desatualizado/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
