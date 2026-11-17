import { describe, expect, it } from "vitest";
import type { CatalogProduct, InventoryRowPayload } from "../api/types";
import {
  emptyPosition,
  hasErrors,
  parseDecimal,
  positionFromRow,
  productProgress,
  toSavePayload,
  validatePosition,
} from "./inventory";

const product = {
  id: "suporte-160",
  name: "Suporte 160",
  code: "5177",
  tracking_stages: [
    { code: "5177", stage: "BLANK", process: "Corte", weight_kg: 0.27, machine: null, scrap_to_next_kg_per_piece: 0 },
    { code: "125178", stage: "FORJA", process: "Forja", weight_kg: 0.27, machine: null, scrap_to_next_kg_per_piece: 0 },
  ],
} as unknown as CatalogProduct;

const row: InventoryRowPayload = {
  product_id: "suporte-160",
  product_name: "Suporte 160",
  process: "Corte",
  position_status: "waiting",
  piece_quantity: 0,
  rod_kg_in_process: 12.5,
  operator_name: "Pedro",
  notes: "",
  updated_at: "2026-09-01T08:00:00",
  reference_date: "2026-09-01",
};

describe("posições do inventário", () => {
  it("preserva o zero oficial vindo do banco", () => {
    const position = positionFromRow(row);
    expect(position.pieceQuantity).toBe("0");
    expect(position.rodKg).toBe("12,5");
    expect(position.savedKey).toBe("Corte::waiting");
  });

  it("trata campo vazio como não informado e recusa texto", () => {
    expect(parseDecimal("")).toBeUndefined();
    expect(parseDecimal("0")).toBe(0);
    expect(parseDecimal("1.280")).toBe(1280);
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(parseDecimal("abc")).toBeNull();
  });

  it("exige quantidade e responsável, preservando kg indisponível", () => {
    const position = emptyPosition(product, "Corte");
    const errors = validatePosition(position, [position]);
    expect(hasErrors(errors)).toBe(true);
    expect(errors.pieceQuantity).toMatch(/quantidade contada/i);
    expect(errors.rodKg).toBeUndefined();
    expect(errors.operatorName).toMatch(/quem realizou/i);
  });

  it("aceita várias posições do mesmo produto e bloqueia duplicidade exata", () => {
    const first = { ...emptyPosition(product, "Corte"), pieceQuantity: "100", rodKg: "10", operatorName: "Ana" };
    const second = {
      ...emptyPosition(product, "Forja"),
      pieceQuantity: "50",
      rodKg: "5",
      operatorName: "Ana",
    };
    expect(hasErrors(validatePosition(first, [first, second]))).toBe(false);
    expect(hasErrors(validatePosition(second, [first, second]))).toBe(false);

    const duplicated = { ...second, process: "Corte" };
    expect(validatePosition(duplicated, [first, duplicated]).duplicate).toMatch(/já existe/i);
  });

  it("envia zero oficial no payload sem transformá-lo em ausência", () => {
    const position = { ...emptyPosition(product, "Corte"), pieceQuantity: "0", rodKg: "0", operatorName: "Ana" };
    expect(toSavePayload(position)).toEqual({
      process: "Corte",
      position_status: "waiting",
      piece_quantity: 0,
      rod_kg_in_process: 0,
      operator_name: "Ana",
      notes: "",
    });
  });

  it("envia kg vazio como indisponível, nunca como zero", () => {
    const position = { ...emptyPosition(product, "Corte"), pieceQuantity: "10", rodKg: "", operatorName: "Ana" };
    expect(toSavePayload(position).rod_kg_in_process).toBeNull();
  });

  it("só considera o produto registrado quando existe posição salva", () => {
    const draft = emptyPosition(product, "Corte");
    expect(productProgress(product.id, [draft]).recorded).toBe(false);
    expect(productProgress(product.id, [positionFromRow(row)]).recorded).toBe(true);
  });
});
