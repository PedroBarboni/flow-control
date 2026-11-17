import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  catalogProduction,
  catalogProducts,
  emptyInventory,
  emptyMaterialLots,
  mockApi,
  overviewWithoutProduct,
} from "./test/apiMock";

const baseRoutes = {
  "/api/products": { body: catalogProducts },
  "/api/catalog/production": { body: catalogProduction },
  "/api/overview": { body: overviewWithoutProduct },
  "/api/inventory/opening": { body: emptyInventory },
  "/api/material-lots": { body: emptyMaterialLots },
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Central de Controle", () => {
  it("mostra o conteúdo operacional já na abertura, sem apresentação promocional", async () => {
    mockApi(baseRoutes);
    render(<App />);

    expect(await screen.findByText("Peças controladas")).toBeInTheDocument();
    expect(screen.getByText("Divergências abertas")).toBeInTheDocument();
    expect(screen.getByText("Inventário de abertura")).toBeInTheDocument();
    expect(screen.getByText("Fontes de dados")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Abrir controle de Conector AT/i })).toBeInTheDocument();
  });

  it("não distribui imagens de peças em nenhuma tela do catálogo", async () => {
    mockApi(baseRoutes);
    const { container } = render(<App />);

    await screen.findByRole("button", { name: /Abrir controle de Conector AT/i });
    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("/assets/logo-branca.png");
  });

  it("filtra o catálogo pela busca da faixa de comando", async () => {
    mockApi(baseRoutes);
    render(<App />);
    await screen.findByRole("button", { name: /Abrir controle de Conector AT/i });

    await userEvent.type(screen.getByRole("searchbox", { name: /buscar peça/i }), "suporte");
    expect(await screen.findByText("Nenhuma peça encontrada")).toBeInTheDocument();
  });

  it("abre o controle da peça preservando o contexto na URL", async () => {
    mockApi({
      ...baseRoutes,
      "/api/overview?product_id=conector-at": {
        body: {
          ...overviewWithoutProduct,
          product: {
            ...catalogProducts[0],
            database_name: "CONECTOR AT",
            stages: [
              {
                name: "Corte",
                tracking_name: "Corte",
                machine: "TORNO",
                totvs_code: "5205",
                reported: 2255,
                loss: 0,
                waiting: 0,
                status: "normal",
                unit_weight_kg: 0.141,
                last_date: "2026-09-01",
                awaiting_pieces: 0,
                guarded_pieces: 0,
                in_process_pieces: 0,
                total_scrap_kg: 0,
                rejection_scrap_kg: 0,
                unidentified_waiting_pieces: 0,
                awaiting_pieces_total: 0,
              },
            ],
            wip: 0,
            visible_wip: 0,
            unidentified_wip: 0,
            unidentified_lots: [],
            actual_pieces: 2255,
            actual_scrap_kg: 0,
            consumed_kg: 0,
            shortage_kg: 0,
            planning_connected: false,
            consumption_connected: false,
            last_production_date: "2026-09-01",
          },
        },
      },
      "/api/totvs/": { status: 503, body: { detail: "Consulta TOTVS indisponível." } },
      "/api/traceability/": { status: 503, body: { detail: "Rastreabilidade indisponível." } },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Abrir controle de Conector AT/i }));

    expect(await screen.findByRole("heading", { level: 1, name: /Conector AT/i })).toBeInTheDocument();
    expect(window.location.search).toContain("produto=conector-at");
    expect(screen.getByText(/Rastreabilidade por lote indisponível/i)).toBeInTheDocument();
  });

  it("declara a indisponibilidade das fontes em vez de presumir conexão", async () => {
    mockApi({ ...baseRoutes, "/api/overview": { status: 503, body: { detail: "Fonte indisponível." } } });
    render(<App />);

    expect(await screen.findByText(/Fontes · Indisponíveis/)).toBeInTheDocument();
  });

  it("informa a falha do catálogo sem inventar peças", async () => {
    mockApi({ ...baseRoutes, "/api/products": { status: 503, body: { detail: "Catálogo fora do ar." } } });
    render(<App />);

    expect(await screen.findByText("Catálogo indisponível")).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma peça foi presumida/)).toBeInTheDocument();
  });

  it("navega para o inventário e para os lotes pela navegação principal", async () => {
    mockApi(baseRoutes);
    render(<App />);
    await screen.findByRole("button", { name: /Abrir controle de Conector AT/i });

    const nav = screen.getByRole("navigation", { name: /navegação principal/i });
    await userEvent.click(within(nav).getByRole("button", { name: "Inventário" }));
    expect(await screen.findByText("Progresso real por produto")).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole("button", { name: "Lotes" }));
    await waitFor(() =>
      expect(screen.getByText("Fechado, em processo ou consumido")).toBeInTheDocument(),
    );
  });

  it("mostra o inventário como pendente e permite abrir pelo atalho da Central", async () => {
    mockApi(baseRoutes);
    render(<App />);

    const shortcut = await screen.findByRole("button", { name: /Inventário de abertura/i });
    await userEvent.click(shortcut);
    expect(await screen.findByText("Progresso real por produto")).toBeInTheDocument();
  });
});
