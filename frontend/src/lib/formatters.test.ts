import { describe, expect, it } from "vitest";
import {
  formatDateBR,
  formatDateTimeBR,
  formatKgBR,
  formatNumberBR,
  formatPieces,
  MISSING_VALUE,
} from "./formatters";

describe("formatação operacional", () => {
  it("preserva o zero oficial e distingue o valor indisponível", () => {
    expect(formatPieces(0)).toBe("0");
    expect(formatPieces(null)).toBe(MISSING_VALUE);
    expect(formatPieces(undefined)).toBe(MISSING_VALUE);
    expect(formatKgBR(0)).toBe("0,000 kg");
    expect(formatKgBR(null)).toBe(MISSING_VALUE);
  });

  it("usa o padrão brasileiro para quantidades e pesos", () => {
    expect(formatNumberBR(12450)).toBe("12.450");
    expect(formatKgBR(3386.5)).toBe("3.386,500 kg");
  });

  it("não deixa o fuso do runtime mover a data de calendário", () => {
    expect(formatDateBR("2026-09-01")).toBe("01/09/2026");
    expect(formatDateBR("2026-09-01T23:30:00")).toBe("01/09/2026");
    expect(formatDateBR("data inválida")).toBe(MISSING_VALUE);
    expect(formatDateTimeBR("2026-09-01T07:45:10")).toBe("01/09/2026 07:45");
  });
});
