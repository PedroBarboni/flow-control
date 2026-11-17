import test from "node:test";
import assert from "node:assert/strict";
import { getPeriodRange, periods } from "../frontend/src/lib/controlCalendar.ts";

test("o ciclo atual começa em 28 de agosto antes da virada", () => {
  assert.deepEqual(getPeriodRange("Ciclo atual", new Date(2026, 7, 30, 12)), {
    from: "2026-08-28",
    to: "2026-08-30",
  });
});

test("a visão atual reinicia em primeiro de setembro e preserva agosto no histórico", () => {
  assert.deepEqual(getPeriodRange("Ciclo atual", new Date(2026, 8, 2, 12)), {
    from: "2026-09-01",
    to: "2026-09-02",
  });
  assert.deepEqual(getPeriodRange("Agosto de 2026", new Date(2026, 8, 2, 12)), {
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.equal(periods[0], "Ciclo atual");
});
