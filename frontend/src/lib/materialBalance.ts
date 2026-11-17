/** Estimativas do vergalhão. Sem peso ou saldo, nada é estimado. */

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const roundKg = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export interface MaterialOutcome {
  pieces: number;
  scrapKg: number;
}

export function transferredLotBalance(
  lots: { balance_kg?: number | null }[] | null | undefined,
): number | null {
  if (!Array.isArray(lots)) return null;
  if (!lots.length) return 0;
  const balances = lots.map((lot) => lot?.balance_kg);
  if (balances.some((value) => !finite(value))) return null;
  return roundKg((balances as number[]).reduce((total, value) => total + value, 0));
}

/** Sucata já produzida por um lote: rejeição das peças perdidas mais a
 * redução de peso das peças que efetivamente saíram, mesma fórmula usada
 * por etapa em `_apply_traceability_to_stages` (backend), aqui por lote. */
export function producedScrapKg(
  producedPieces: unknown,
  lossPieces: unknown,
  blankWeightKg: unknown,
  stages: { scrap_to_next_kg_per_piece?: number | null }[] | null | undefined,
): number | null {
  if (!finite(producedPieces) || !finite(lossPieces) || !finite(blankWeightKg) || blankWeightKg <= 0) return null;
  if (!Array.isArray(stages) || !stages.length) return null;
  const reductions = stages.map((stage) => stage?.scrap_to_next_kg_per_piece);
  if (reductions.some((value) => !finite(value) || value < 0)) return null;
  const scrapPerPiece = (reductions as number[]).reduce((total, value) => total + value, 0);
  const rejectionKg = lossPieces * blankWeightKg;
  const processKg = producedPieces * scrapPerPiece;
  return roundKg(rejectionKg + processKg);
}

export function estimateMaterialOutcome(
  balanceKg: unknown,
  blankWeightKg: unknown,
  stages: { scrap_to_next_kg_per_piece?: number | null }[] | null | undefined,
): MaterialOutcome | null {
  if (!finite(balanceKg) || balanceKg < 0 || !finite(blankWeightKg) || blankWeightKg <= 0) return null;
  if (!Array.isArray(stages) || !stages.length) return null;
  const reductions = stages.map((stage) => stage?.scrap_to_next_kg_per_piece);
  if (reductions.some((value) => !finite(value) || value < 0)) return null;
  const pieces = Math.floor(balanceKg / blankWeightKg);
  const scrapPerPiece = (reductions as number[]).reduce((total, value) => total + value, 0);
  return { pieces, scrapKg: roundKg(pieces * scrapPerPiece) };
}
