/**
 * Memória de cálculo do vergalhão por lote.
 *
 * Consumo oficial e consumo calculado nunca se misturam: cada linha declara a
 * origem. Sem apontamento de Blank não existe cálculo.
 */

import type { MaterialLotRow } from "../api/types";
import { formatKgBR, formatNumberBR, hasNumber } from "./formatters";

export type AuditRow = [label: string, value: string];

const dateKey = (value: unknown): string => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}${match[2]}${match[1]}` : "99999999";
};

export type AuditMaterialLot = Partial<MaterialLotRow>;

const oldestFirst = (lots: AuditMaterialLot[] | undefined): AuditMaterialLot[] =>
  [...(Array.isArray(lots) ? lots : [])].sort(
    (left, right) =>
      dateKey(left?.date).localeCompare(dateKey(right?.date)) ||
      Number(left?.source_record || 0) - Number(right?.source_record || 0),
  );

interface BlankConsumption {
  blanks: number;
  losses: number;
  unitWeight: number;
  kg: number;
}

const blankConsumption = (product: {
  stages?: { reported?: number | null; loss?: number | null; unit_weight_kg?: number | null }[];
}): BlankConsumption | null => {
  const blank = Array.isArray(product?.stages) ? product.stages[0] : null;
  if (!blank || ![blank.reported, blank.loss, blank.unit_weight_kg].every(hasNumber)) return null;
  return {
    blanks: blank.reported as number,
    losses: blank.loss as number,
    unitWeight: blank.unit_weight_kg as number,
    kg: ((blank.reported as number) + (blank.loss as number)) * (blank.unit_weight_kg as number),
  };
};

function calculatedLotPosition(
  lots: AuditMaterialLot[],
  consumedKg: number,
): { lot: AuditMaterialLot | null; balance: number } {
  const ordered = oldestFirst(lots);
  let remaining = Math.max(consumedKg, 0);
  for (const lot of ordered) {
    const initial = hasNumber(lot?.initial_kg) ? lot.initial_kg : 0;
    if (remaining >= initial && initial > 0) {
      remaining -= initial;
      continue;
    }
    return { lot, balance: Math.max(initial - remaining, 0) };
  }
  return { lot: null, balance: 0 };
}

export function materialAuditRows(
  totvs: { transferred_kg?: number | null; lots?: AuditMaterialLot[] } = {},
  product: {
    consumption_connected?: boolean;
    consumed_kg?: number | null;
    stages?: { reported?: number | null; loss?: number | null; unit_weight_kg?: number | null }[];
  } = {},
): AuditRow[] {
  const lots = oldestFirst(totvs.lots);
  const official = product.consumption_connected === true && hasNumber(product.consumed_kg);
  const calculated = official ? null : blankConsumption(product);
  const consumedKg = official ? (product.consumed_kg as number) : calculated?.kg;
  const officialActive = lots.find((lot) => hasNumber(lot?.balance_kg) && lot.balance_kg > 0) || null;
  const calculatedActive = hasNumber(consumedKg)
    ? calculatedLotPosition(lots, consumedKg)
    : { lot: lots[0] || null, balance: null as number | null };
  const active = official ? officialActive : calculatedActive.lot;
  const balance = official ? officialActive?.balance_kg : calculatedActive.balance;
  const consumed = hasNumber(consumedKg)
    ? `${formatKgBR(consumedKg)} · ${official ? "oficial" : "calculado"}`
    : "Não informado";
  const basis = official
    ? "Baixa oficial vinculada ao lote"
    : calculated
      ? `${formatNumberBR(calculated.blanks)} blanks + ${formatNumberBR(calculated.losses)} perdas × ${formatNumberBR(
          calculated.unitWeight,
          { minimumFractionDigits: 3, maximumFractionDigits: 3 },
        )} kg`
      : "Sem apontamento de Blank para calcular";

  return [
    ["Lote oficial do vergalhão", active?.id || "Identificação ausente"],
    ["Vergalhão transferido", hasNumber(totvs.transferred_kg) ? formatKgBR(totvs.transferred_kg) : "Não informado"],
    [official ? "Consumo oficial" : "Consumo calculado", consumed],
    [
      official ? "Saldo oficial do lote ativo" : "Saldo calculado do lote ativo",
      hasNumber(balance) ? formatKgBR(balance) : "Dado indisponível",
    ],
    ["Base do consumo", basis],
  ];
}
