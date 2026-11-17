import test from "node:test";
import assert from "node:assert/strict";
import { estimateMaterialOutcome, transferredLotBalance } from "../frontend/src/lib/materialBalance.ts";

const stages = [
  { scrap_to_next_kg_per_piece: 0 },
  { scrap_to_next_kg_per_piece: 0.067 },
  { scrap_to_next_kg_per_piece: 0.042 },
  { scrap_to_next_kg_per_piece: 0 },
  { scrap_to_next_kg_per_piece: 0 },
];

test("estima peças e sucata do saldo do Armazém 01", () => {
  assert.deepEqual(estimateMaterialOutcome(4547, 0.323, stages), {
    pieces: 14077,
    scrapKg: 1534.393,
  });
});

test("estima peças e sucata usando somente o saldo transferido", () => {
  const balance = transferredLotBalance([{ balance_kg: 3386.5 }]);
  assert.equal(balance, 3386.5);
  assert.deepEqual(estimateMaterialOutcome(balance, 0.323, stages), {
    pieces: 10484,
    scrapKg: 1142.756,
  });
});

test("não inventa estimativa quando peso ou saldo não estão disponíveis", () => {
  assert.equal(estimateMaterialOutcome(null, 0.323, stages), null);
  assert.equal(estimateMaterialOutcome(100, null, stages), null);
  assert.equal(transferredLotBalance(null), null);
});
