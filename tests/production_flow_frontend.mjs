import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionFlow } from "../frontend/src/lib/productionFlow.ts";

const stages = [
  { tracking_name: "Corte", reported: 100, loss: 2, unit_weight_kg: 0.141 },
  { tracking_name: "Rebaixo", reported: 0, loss: 0 },
  { tracking_name: "Forja", reported: 100, loss: 0 },
];

test("usa os saldos oficiais por lote sem subtrair totais globais", () => {
  const flow = buildProductionFlow(stages, {
    material: {
      active_lot_id: "LT-5205-001",
      initial_kg: 500,
      consumed_kg: 14.382,
      remaining_kg: 485.618,
      method: "calculado",
    },
    stages: [
      { process: "REBAIXO", available_pieces: 100, identified_pieces: 100, opening_pieces: 0, unmatched_pieces: 0 },
      { process: "FORJA", available_pieces: 1100, identified_pieces: 0, opening_pieces: 1100, unmatched_pieces: 0 },
    ],
    unmatched_pieces: 0,
  });

  assert.equal(flow.material.remaining_kg, 485.618);
  assert.equal(flow.stages[0].flow_balance, 0);
  assert.equal(flow.stages[1].flow_balance, 100);
  assert.equal(flow.stages[2].flow_balance, 1100);
  assert.equal(flow.stages[2].opening_pieces, 1100);
  assert.equal(flow.wip, 1200);
});

test("não inventa saldo quando a rastreabilidade está indisponível", () => {
  const flow = buildProductionFlow(stages, null);

  assert.equal(flow.material.available, false);
  assert.equal(flow.stages[0].flow_balance, null);
  assert.equal(flow.wip, null);
});
