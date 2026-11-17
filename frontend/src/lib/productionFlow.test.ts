import { describe, expect, it } from "vitest";
import type { StageRow, TraceabilityPayload, TraceabilityStage } from "../api/types";
import { buildProductionFlow } from "./productionFlow";

const stages: StageRow[] = [
  { name: "Corte", tracking_name: "Corte", unit_weight_kg: 0.27 } as StageRow,
];

const traceabilityStage = (overrides: Partial<TraceabilityStage>): TraceabilityStage => ({
  process: "CORTE",
  available_pieces: 0,
  identified_pieces: 0,
  opening_pieces: 0,
  unmatched_pieces: 0,
  lots: [],
  ...overrides,
});

const baseTraceability = (
  overrides: Partial<TraceabilityPayload["material"]>,
): TraceabilityPayload =>
  ({
    product_id: "p",
    material: {
      active_lot_id: null,
      initial_kg: null,
      consumed_kg: null,
      remaining_kg: null,
      method: "calculado",
      lots: [],
      ...overrides,
    },
    stages: [],
    unmatched_pieces: 0,
    unmatched: [],
    source_status: {},
  }) as TraceabilityPayload;

describe("lote ativo do vergalhão", () => {
  it("mostra somente o lote ativo, não a soma de todos os lotes", () => {
    const traceability = baseTraceability({
      active_lot_id: "LT-1",
      initial_kg: 1000,
      consumed_kg: 400,
      remaining_kg: 600,
      lots: [
        { lot_id: "LT-1", initial_kg: 700, balance_kg: 300, consumed_kg: 400, transformed_pieces: 0, loss_pieces: 0 },
        { lot_id: "LT-2", initial_kg: 300, balance_kg: 300, consumed_kg: 0, transformed_pieces: 0, loss_pieces: 0 },
      ],
    });

    const flow = buildProductionFlow(stages, traceability);

    expect(flow.material.active_lot_balance_kg).toBe(300);
    expect(flow.material.active_lot_initial_kg).toBe(700);
    expect(flow.material.active_lot_consumed_kg).toBe(400);
    // O agregado dos dois lotes (600) não deve vazar para o campo do lote ativo.
    expect(flow.material.active_lot_balance_kg).not.toBe(flow.material.remaining_kg);
  });

  it("troca para o próximo lote quando o ativo esgota, sem somar os dois", () => {
    const traceability = baseTraceability({
      active_lot_id: "LT-2",
      initial_kg: 1000,
      consumed_kg: 700,
      remaining_kg: 300,
      lots: [
        { lot_id: "LT-1", initial_kg: 700, balance_kg: 0, consumed_kg: 700, transformed_pieces: 0, loss_pieces: 0 },
        { lot_id: "LT-2", initial_kg: 300, balance_kg: 300, consumed_kg: 0, transformed_pieces: 0, loss_pieces: 0 },
      ],
    });

    const flow = buildProductionFlow(stages, traceability);

    expect(flow.material.active_lot_balance_kg).toBe(300);
    expect(flow.material.active_lot_initial_kg).toBe(300);
    expect(flow.material.active_lot_consumed_kg).toBe(0);
  });

  it("sem lote ativo, os campos do lote não presumem zero", () => {
    const traceability = baseTraceability({ active_lot_id: null, lots: [] });
    const flow = buildProductionFlow(stages, traceability);

    expect(flow.material.active_lot_balance_kg).toBeNull();
    expect(flow.material.active_lot_initial_kg).toBeNull();
    expect(flow.material.active_lot_consumed_kg).toBeNull();
    expect(flow.material.active_lot_remaining_pieces).toBeNull();
  });
});

describe("reconciliação entre saldo calculado e rastreabilidade por lote", () => {
  it("deixa de marcar como sem lote quando a rastreabilidade já identificou o lote de vergalhão", () => {
    const stageWithBacklog: StageRow[] = [
      { name: "Forja", tracking_name: "Forja", unit_weight_kg: 0.27, unidentified_waiting_pieces: 14151 } as StageRow,
    ];
    const traceability = baseTraceability({ lots: [] });
    traceability.stages = [traceabilityStage({ process: "FORJA", identified_pieces: 14151 })];

    const flow = buildProductionFlow(stageWithBacklog, traceability);

    expect(flow.stages[0].identified_pieces).toBe(14151);
    expect(flow.stages[0].unidentified_waiting_pieces).toBe(0);
  });

  it("mantém sem lote apenas a parte que nenhum dos dois cálculos explica", () => {
    const stageWithBacklog: StageRow[] = [
      { name: "Forja", tracking_name: "Forja", unit_weight_kg: 0.27, unidentified_waiting_pieces: 1000 } as StageRow,
    ];
    const traceability = baseTraceability({ lots: [] });
    traceability.stages = [traceabilityStage({ process: "FORJA", identified_pieces: 600 })];

    const flow = buildProductionFlow(stageWithBacklog, traceability);

    expect(flow.stages[0].identified_pieces).toBe(600);
    expect(flow.stages[0].unidentified_waiting_pieces).toBe(400);
  });

  it("casa a etapa com a rastreabilidade mesmo com hífen no nome (ex.: Pré-acabado)", () => {
    const stageWithHyphen: StageRow[] = [
      { name: "Pré-acabado", tracking_name: "Pré-acabado", unit_weight_kg: 0.27 } as StageRow,
    ];
    const traceability = baseTraceability({ lots: [] });
    // A rastreabilidade guarda a etapa como "PRE_ACABADO" (backend/traceability_service._process).
    traceability.stages = [traceabilityStage({ process: "PRE_ACABADO", opening_pieces: 2361 })];

    const flow = buildProductionFlow(stageWithHyphen, traceability);

    expect(flow.stages[0].opening_pieces).toBe(2361);
  });
});
