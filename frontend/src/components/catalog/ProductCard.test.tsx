import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogProduct, CatalogProductionRow } from "../../api/types";
import ProductCard from "./ProductCard";

const product = {
  id: "conector-at",
  name: "Conector AT",
  code: "5205",
  rod: "VERGALHAO LATAO 15,880",
  rod_diameter_mm: "15.880",
  rod_material: "LATÃO 377 1/2 DURO",
  rod_available: true,
  tracking_stages: [
    { code: "5205", stage: "BLANK", process: "Corte", weight_kg: 0.141, machine: "TORNO", scrap_to_next_kg_per_piece: 0.034 },
  ],
  totvs_destination_codes: ["5205"],
} as unknown as CatalogProduct;

const production: CatalogProductionRow = {
  product_id: "conector-at",
  produced_pieces: 12450,
  in_process_pieces: 1280,
  identified_in_process_pieces: 1280,
  unidentified_in_process_pieces: 0,
  last_production_date: "2026-09-01",
  attention: false,
  critical: false,
};

describe("card tipográfico da peça", () => {
  it("identifica a peça pelo nome e pelo código oficial, sem imagem", () => {
    const { container } = render(
      <ProductCard product={product} production={production} productionAvailable onSelect={() => {}} />,
    );

    expect(screen.getByText("Conector AT")).toBeInTheDocument();
    expect(screen.getByText(/CÓDIGO:\s*5205/)).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("picture, figure")).toHaveLength(0);
  });

  it("mostra já produzido e em processo com os valores oficiais", () => {
    render(<ProductCard product={product} production={production} productionAvailable onSelect={() => {}} />);

    expect(screen.getByText("Já produzido")).toBeInTheDocument();
    expect(screen.getByText("12.450")).toBeInTheDocument();
    expect(screen.getByText("Em processo")).toBeInTheDocument();
    expect(screen.getByText("1.280")).toBeInTheDocument();
  });

  it("apresenta zero oficial como 0 e ausência como Não informado", () => {
    const { rerender } = render(
      <ProductCard
        product={product}
        production={{ ...production, produced_pieces: 0, in_process_pieces: 0 }}
        productionAvailable
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByText("0")).toHaveLength(2);

    rerender(<ProductCard product={product} productionAvailable={false} onSelect={() => {}} />);
    expect(screen.getAllByText("Não informado")).toHaveLength(2);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("sinaliza divergência sem lote identificado em âmbar", () => {
    render(
      <ProductCard
        product={product}
        production={{ ...production, unidentified_in_process_pieces: 1550 }}
        productionAvailable
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/1.550 sem lote identificado/)).toBeInTheDocument();
    expect(screen.getByText(/Divergência entre operações/)).toBeInTheDocument();
  });

  it("mostra o lote conciliado sem sinalizar divergência", () => {
    render(
      <ProductCard
        product={product}
        production={{
          ...production,
          in_process_pieces: 3170,
          identified_in_process_pieces: 3170,
          unidentified_in_process_pieces: 0,
          material_lot_id: "LT-5121-001",
          production_lot_id: "LT-5121-001-P001",
        }}
        productionAvailable
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText("3.170")).toBeInTheDocument();
    expect(screen.getByText(/lote LT-5121-001/i)).toBeInTheDocument();
    expect(screen.queryByText(/sem lote identificado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/divergência entre operações/i)).not.toBeInTheDocument();
  });

  it("o card inteiro abre o controle da peça", async () => {
    const onSelect = vi.fn();
    render(<ProductCard product={product} production={production} productionAvailable onSelect={onSelect} />);

    const card = screen.getByRole("button", { name: /Abrir controle de Conector AT/i });
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("conector-at");
  });
});
