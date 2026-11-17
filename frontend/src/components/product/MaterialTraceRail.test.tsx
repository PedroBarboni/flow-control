import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TotvsPayload, TraceabilityPayload } from "../../api/types";
import MaterialTraceRail from "./MaterialTraceRail";

describe("rastreabilidade do material", () => {
  it("mostra os blanks reconhecidos no lote oficial do Placa 160", () => {
    const totvs = {
      status: "online",
      message: "Dados atualizados",
      stock: { warehouse: "01", total_kg: 8380, balances: [] },
      movements: [],
      lots: [{
        id: "LT-5121-001",
        material_code: "001817",
        initial_kg: 3386.5,
        balance_kg: 2005.675,
        status: "closed",
        date: "28/08/2026",
        document: "000080013",
        destination: "5121",
      }],
    } satisfies TotvsPayload;
    const traceability = {
      product_id: "placa-160",
      material: {
        active_lot_id: "LT-5121-001",
        initial_kg: 3386.5,
        consumed_kg: 1380.825,
        remaining_kg: 2005.675,
        method: "calculado",
        lots: [{
          lot_id: "LT-5121-001",
          initial_kg: 3386.5,
          balance_kg: 2005.675,
          consumed_kg: 1380.825,
          transformed_pieces: 4240,
          loss_pieces: 35,
        }],
      },
      stages: [],
      unmatched_pieces: 0,
      unmatched: [],
      source_status: { totvs: "online", apontamentos: "online" },
    } satisfies TraceabilityPayload;

    render(
      <MaterialTraceRail
        totvs={totvs}
        totvsLoading={false}
        materialLotId="LT-5121-001"
        traceability={traceability}
        onAudit={vi.fn()}
      />,
    );

    const lot = screen.getByText("LT-5121-001").closest("article") as HTMLElement;
    expect(within(lot).getByText("Blanks transformados")).toBeInTheDocument();
    expect(within(lot).getByText("4.240 peças")).toBeInTheDocument();
    expect(within(lot).getByText("35 perdas")).toBeInTheDocument();
    expect(within(lot).getByText(/calculado por apontamentos/i)).toBeInTheDocument();
  });
});
