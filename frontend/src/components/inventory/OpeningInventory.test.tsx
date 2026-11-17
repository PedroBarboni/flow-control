import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct, InventoryPayload } from "../../api/types";
import { catalogProducts, mockApi } from "../../test/apiMock";
import OpeningInventory from "./OpeningInventory";

const products = catalogProducts as unknown as CatalogProduct[];

const inventory: InventoryPayload = {
  reference_date: "2026-09-01",
  reference_date_label: "01/09/2026",
  rows: [],
  recorded_positions: 0,
  recorded_products: 0,
  total_products: 1,
  pending_product_ids: ["conector-at"],
  ready: false,
};

const setup = (payload: InventoryPayload = inventory) =>
  render(
    <OpeningInventory
      products={products}
      inventory={payload}
      loading={false}
      error=""
      onReload={() => {}}
      onUnsavedChange={() => {}}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inventário de abertura", () => {
  it("fica somente para consulta quando a trava operacional está ativa", () => {
    setup({ ...inventory, locked: true, lock_message: "Inventário temporariamente bloqueado." });

    expect(screen.getByRole("status")).toHaveTextContent("Inventário temporariamente bloqueado");
    expect(screen.getByRole("button", { name: /adicionar posição/i })).toBeDisabled();
  });
  it("mostra produto sem contagem como não informado, nunca como zero", () => {
    setup();
    expect(screen.getByText(/O valor permanece/)).toBeInTheDocument();
    expect(screen.getAllByText("Não informado").length).toBeGreaterThan(0);
    expect(screen.getByText("Aguardando registro")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("0")).not.toBeInTheDocument();
  });

  it("permite registrar mais de uma posição para o mesmo produto", async () => {
    setup();
    const add = screen.getByRole("button", { name: /adicionar posição/i });

    await userEvent.click(add);
    await userEvent.click(add);

    expect(screen.getAllByLabelText("Operação atual")).toHaveLength(2);
    expect(screen.getAllByLabelText("Quantidade de peças")).toHaveLength(2);
  });

  it("valida perto do campo e não envia nada incompleto", async () => {
    const { fetchMock } = mockApi({});
    setup();

    await userEvent.click(screen.getByRole("button", { name: /adicionar posição/i }));
    await userEvent.click(screen.getByRole("button", { name: /salvar posição/i }));

    expect(await screen.findByText(/Informe a quantidade contada/)).toBeInTheDocument();
    expect(screen.getByText(/Informe quem realizou a contagem/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("salva a posição e anuncia o resultado por aria-live", async () => {
    const { fetchMock } = mockApi({
      "/api/inventory/opening/conector-at": {
        body: { status: "saved", product_id: "conector-at", updated_at: "2026-09-01T10:00:00" },
      },
    });
    setup();

    await userEvent.click(screen.getByRole("button", { name: /adicionar posição/i }));
    await userEvent.type(screen.getByLabelText("Quantidade de peças"), "0");
    await userEvent.type(screen.getByLabelText("Kg de vergalhão em processo"), "12,5");
    await userEvent.type(screen.getByLabelText("Responsável pela contagem"), "Ana");
    await userEvent.click(screen.getByRole("button", { name: /salvar posição/i }));

    await waitFor(() => expect(screen.getByText(/salva no controle/)).toBeInTheDocument());

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/inventory/opening/conector-at");
    expect(JSON.parse(String((request[1] as RequestInit).body))).toEqual({
      process: "Corte",
      position_status: "waiting",
      piece_quantity: 0,
      rod_kg_in_process: 12.5,
      operator_name: "Ana",
      notes: "",
    });
  });

  it("reporta o erro da API sem marcar a posição como salva", async () => {
    mockApi({
      "/api/inventory/opening/conector-at": { status: 503, body: { detail: "Banco do controle indisponível." } },
    });
    setup();

    await userEvent.click(screen.getByRole("button", { name: /adicionar posição/i }));
    await userEvent.type(screen.getByLabelText("Quantidade de peças"), "10");
    await userEvent.type(screen.getByLabelText("Kg de vergalhão em processo"), "1");
    await userEvent.type(screen.getByLabelText("Responsável pela contagem"), "Ana");
    await userEvent.click(screen.getByRole("button", { name: /salvar posição/i }));

    expect(await screen.findByText(/Banco do controle indisponível/)).toBeInTheDocument();
    expect(screen.getByText("Não salvo")).toBeInTheDocument();
  });

  it("filtra somente os produtos pendentes", async () => {
    setup({
      ...inventory,
      rows: [
        {
          product_id: "conector-at",
          product_name: "Conector AT",
          process: "Corte",
          position_status: "waiting",
          piece_quantity: 0,
          rod_kg_in_process: 0,
          operator_name: "Ana",
          notes: "",
          updated_at: "2026-09-01T08:00:00",
          reference_date: "2026-09-01",
        },
      ],
      recorded_positions: 1,
      recorded_products: 1,
      pending_product_ids: [],
      ready: true,
    });

    expect(screen.getByText(/Todos os produtos têm posição registrada/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/somente produtos pendentes/i));
    expect(await screen.findByText("Nenhum produto pendente")).toBeInTheDocument();
  });

  it("bloqueia a troca de operação de uma posição já salva", () => {
    setup({
      ...inventory,
      rows: [
        {
          product_id: "conector-at",
          product_name: "Conector AT",
          process: "Corte",
          position_status: "in_process",
          piece_quantity: 1280,
          rod_kg_in_process: 180.5,
          operator_name: "Ana",
          notes: "",
          updated_at: "2026-09-01T08:00:00",
          reference_date: "2026-09-01",
        },
      ],
      recorded_positions: 1,
      recorded_products: 1,
      pending_product_ids: [],
      ready: true,
    });

    const position = screen.getByLabelText("Operação atual").closest("li") as HTMLElement;
    expect(within(position).getByLabelText("Operação atual")).toBeDisabled();
    expect(screen.getByDisplayValue("1280")).toBeInTheDocument();
    expect(screen.getByText("Salvo")).toBeInTheDocument();
  });
});
