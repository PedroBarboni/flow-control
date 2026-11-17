/**
 * Inventário de abertura.
 *
 * Um produto pode ter várias posições (operação + situação). Campo em branco
 * significa "não informado" e nunca é convertido em zero; zero digitado é um
 * valor oficial e é preservado.
 */

import type { CatalogProduct, InventoryRowPayload, InventorySavePayload } from "../api/types";

export type PositionStatus = "waiting" | "in_process" | "completed";

export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  waiting: "Aguardando",
  in_process: "Em processo",
  completed: "Concluído",
};

export interface InventoryPosition {
  /** Chave estável no cliente; posições novas não existem na API ainda. */
  key: string;
  productId: string;
  productName: string;
  process: string;
  positionStatus: PositionStatus;
  pieceQuantity: string;
  rodKg: string;
  operatorName: string;
  notes: string;
  /** Chave persistida (operação + situação) usada para detectar substituição. */
  savedKey: string | null;
  savedAt: string | null;
  dirty: boolean;
}

export interface PositionErrors {
  process?: string;
  pieceQuantity?: string;
  rodKg?: string;
  operatorName?: string;
  duplicate?: string;
}

let sequence = 0;
const nextKey = (productId: string): string => {
  sequence += 1;
  return `${productId}::novo-${sequence}`;
};

/** Converte o valor persistido para o campo, preservando zero oficial. */
const decimalToInput = (value: number | null | undefined, decimals: number): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const fixed = value.toFixed(decimals);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed.replace(".", ",");
};

export function positionFromRow(row: InventoryRowPayload): InventoryPosition {
  const savedKey = `${row.process}::${row.position_status}`;
  return {
    key: `${row.product_id}::${savedKey}`,
    productId: row.product_id,
    productName: row.product_name,
    process: row.process,
    positionStatus: (["waiting", "in_process", "completed"].includes(row.position_status)
      ? row.position_status
      : "waiting") as PositionStatus,
    pieceQuantity: decimalToInput(row.piece_quantity, 3),
    rodKg: decimalToInput(row.rod_kg_in_process, 3),
    operatorName: row.operator_name || "",
    notes: row.notes || "",
    savedKey,
    savedAt: row.updated_at,
    dirty: false,
  };
}

export function emptyPosition(product: CatalogProduct, process: string): InventoryPosition {
  return {
    key: nextKey(product.id),
    productId: product.id,
    productName: product.name,
    process,
    positionStatus: "waiting",
    pieceQuantity: "",
    rodKg: "",
    operatorName: "",
    notes: "",
    savedKey: null,
    savedAt: null,
    dirty: false,
  };
}

/** Converte entrada brasileira em número; string vazia é "não informado". */
export function parseDecimal(value: string): number | null | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const normalized = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function validatePosition(
  position: InventoryPosition,
  siblings: InventoryPosition[],
): PositionErrors {
  const errors: PositionErrors = {};

  if (!position.process.trim()) {
    errors.process = "Escolha a operação onde as peças estão paradas.";
  }

  const pieces = parseDecimal(position.pieceQuantity);
  if (pieces === undefined) {
    errors.pieceQuantity = "Informe a quantidade contada. Use 0 se a operação está vazia.";
  } else if (pieces === null) {
    errors.pieceQuantity = "Use apenas números, por exemplo 1.280 ou 1280.";
  }

  const rod = parseDecimal(position.rodKg);
  if (rod === null) {
    errors.rodKg = "Use apenas números, por exemplo 12,500.";
  }

  if (!position.operatorName.trim()) {
    errors.operatorName = "Informe quem realizou a contagem.";
  }

  const duplicate = siblings.some(
    (other) =>
      other.key !== position.key &&
      other.process.trim().toLowerCase() === position.process.trim().toLowerCase() &&
      other.positionStatus === position.positionStatus,
  );
  if (duplicate) {
    errors.duplicate = "Já existe uma posição desta operação com a mesma situação.";
  }

  return errors;
}

export const hasErrors = (errors: PositionErrors): boolean => Object.keys(errors).length > 0;

export function toSavePayload(position: InventoryPosition): InventorySavePayload {
  return {
    process: position.process.trim(),
    position_status: position.positionStatus,
    piece_quantity: parseDecimal(position.pieceQuantity) as number,
    rod_kg_in_process: parseDecimal(position.rodKg) ?? null,
    operator_name: position.operatorName.trim(),
    notes: position.notes.trim(),
  };
}

export interface ProductProgress {
  productId: string;
  positions: number;
  savedPositions: number;
  pendingPositions: number;
  /** Produto sem nenhuma posição registrada permanece "não informado". */
  recorded: boolean;
}

export function productProgress(
  productId: string,
  positions: InventoryPosition[],
): ProductProgress {
  const own = positions.filter((position) => position.productId === productId);
  const saved = own.filter((position) => position.savedKey !== null && !position.dirty);
  return {
    productId,
    positions: own.length,
    savedPositions: saved.length,
    pendingPositions: own.length - saved.length,
    recorded: saved.length > 0,
  };
}
