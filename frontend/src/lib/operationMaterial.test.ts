import { test, assert } from "vitest";
import { materialAuditRows } from "./operationMaterial";

test("a auditoria identifica o lote do vergalhão sem inventar consumo", () => {
  const rows = materialAuditRows(
    {
      transferred_kg: 3386.5,
      lots: [{ id: "LT-5121-001", initial_kg: 3386.5, balance_kg: 3386.5 }],
    },
    {
      consumption_connected: false,
      stages: [{ reported: 1115, loss: 10, unit_weight_kg: 0.323 }],
    },
  );

  assert.deepEqual(rows, [
    ["Lote oficial do vergalhão", "LT-5121-001"],
    ["Vergalhão transferido", "3.386,500 kg"],
    ["Consumo calculado", "363,375 kg · calculado"],
    ["Saldo calculado do lote ativo", "3.023,125 kg"],
    ["Base do consumo", "1.115 blanks + 10 perdas × 0,323 kg"],
  ]);
});

test("a auditoria mostra o consumo oficial quando a integração estiver conectada", () => {
  const rows = materialAuditRows(
    { transferred_kg: 1000, lots: [{ id: "LT-5119-002", balance_kg: 250 }] },
    { consumption_connected: true, consumed_kg: 750 },
  );

  assert.equal(rows[1][0], "Vergalhão transferido");
  assert.equal(rows[2][0], "Consumo oficial");
  assert.equal(rows[2][1], "750,000 kg · oficial");
  assert.equal(rows[3][0], "Saldo oficial do lote ativo");
});

test("o consumo calculado segue o lote mais antigo primeiro", () => {
  const rows = materialAuditRows(
    {
      transferred_kg: 700,
      lots: [
        { id: "LT-NOVO", initial_kg: 400, date: "28/08/2026", source_record: 2 },
        { id: "LT-ANTIGO", initial_kg: 300, date: "27/08/2026", source_record: 1 },
      ],
    },
    { consumption_connected: false, stages: [{ reported: 350, loss: 0, unit_weight_kg: 1 }] },
  );

  assert.equal(rows[0][1], "LT-NOVO");
  assert.equal(rows[2][1], "350,000 kg · calculado");
});

test("valores ausentes não viram zero na auditoria", () => {
  const rows = materialAuditRows({}, { consumption_connected: false });

  assert.equal(rows[0][1], "Identificação ausente");
  assert.equal(rows[1][1], "Não informado");
  assert.equal(rows[2][1], "Não informado");
  assert.equal(rows[3][1], "Dado indisponível");
});
