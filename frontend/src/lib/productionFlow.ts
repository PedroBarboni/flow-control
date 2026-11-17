/**
 * Projeção do fluxo produtivo a partir da rastreabilidade oficial.
 *
 * Sem snapshot de rastreabilidade nada é presumido: saldo, WIP e divergência
 * ficam nulos em vez de zero. Os saldos vêm por lote, nunca de subtração de
 * totais globais.
 */

import type { StageRow, TraceabilityPayload, TraceabilityStageLot } from "../api/types";

const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Precisa gerar a mesma chave que o backend usa para nomear a etapa na
// rastreabilidade (backend/traceability_service.py:_process): sem isso,
// qualquer etapa com espa\u00e7o ou h\u00edfen no nome (ex.: "Pr\u00e9-acabado") nunca casa
// com a posi\u00e7\u00e3o da fila, e a tela mostra a etapa como se n\u00e3o tivesse dado
// nenhum, mesmo quando a rastreabilidade j\u00e1 sabe o saldo dela.
const normalize = (value: unknown): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export interface FlowStage extends StageRow {
  flow_balance: number | null;
  flow_divergence: number | null;
  opening_pieces: number | null;
  identified_pieces: number | null;
  /** Composição da PILHA exibida (fila da etapa seguinte), não desta etapa. */
  queue_opening_pieces: number | null;
  queue_identified_pieces: number | null;
  flow_next_name: string | null;
  traceability_lots: TraceabilityStageLot[];
}

export interface FlowMaterial {
  available: boolean;
  active_lot_id: string | null;
  initial_kg: number | null;
  consumed_kg: number | null;
  remaining_kg: number | null;
  blank_weight_kg?: number | null;
  estimated_pieces: number | null;
  consumed_pieces: number | null;
  remaining_pieces: number | null;
  /** Peso do lote ativo isoladamente — não somado ao saldo de lotes seguintes
   * ainda não iniciados. Quando o lote ativo esgota, o próximo lote assume
   * estes campos sozinho, em vez de acumular com o anterior. */
  active_lot_initial_kg: number | null;
  active_lot_consumed_kg: number | null;
  active_lot_balance_kg: number | null;
  active_lot_remaining_pieces: number | null;
  method?: string;
  flow_divergence?: number;
}

export interface ProductionFlow {
  material: FlowMaterial;
  stages: FlowStage[];
  wip: number | null;
  divergence: number | null;
  sourceStatus: Record<string, string>;
}

const piecesFrom = (kg: unknown, blank: unknown): number | null =>
  numeric(kg) && numeric(blank) && blank > 0 ? Math.floor(kg / blank + 1e-9) : null;

export function buildProductionFlow(
  stages: StageRow[] = [],
  traceability: TraceabilityPayload | null = null,
): ProductionFlow {
  const source = Array.isArray(stages) ? stages : [];

  if (!traceability || typeof traceability !== "object") {
    return {
      material: {
        available: false,
        active_lot_id: null,
        initial_kg: null,
        consumed_kg: null,
        remaining_kg: null,
        estimated_pieces: null,
        consumed_pieces: null,
        remaining_pieces: null,
        active_lot_initial_kg: null,
        active_lot_consumed_kg: null,
        active_lot_balance_kg: null,
        active_lot_remaining_pieces: null,
      },
      stages: source.map((stage, index) => ({
        ...stage,
        flow_balance: null,
        flow_divergence: null,
        opening_pieces: null,
        identified_pieces: null,
        queue_opening_pieces: null,
        queue_identified_pieces: null,
        // A ordem da rota é cadastro, não rastreabilidade: mesmo sem o motor
        // a etapa seguinte é conhecida, e é ela que nomeia o destino da pilha.
        flow_next_name: source[index + 1]?.tracking_name || source[index + 1]?.name || null,
        traceability_lots: [],
      })),
      wip: null,
      divergence: null,
      sourceStatus: { apontamentos: "indisponivel", totvs: "indisponivel" },
    };
  }

  const traceStages = new Map(
    (Array.isArray(traceability.stages) ? traceability.stages : []).map((row) => [
      normalize(row.process),
      row,
    ]),
  );
  const blankWeight = numeric(source[0]?.unit_weight_kg) ? (source[0].unit_weight_kg as number) : null;
  const input = traceability.material || ({} as TraceabilityPayload["material"]);
  const initialKg = numeric(input.initial_kg) ? input.initial_kg : null;
  const consumedKg = numeric(input.consumed_kg) ? input.consumed_kg : null;
  const remainingKg = numeric(input.remaining_kg) ? input.remaining_kg : null;

  // O lote ativo (FIFO) é exibido sozinho: enquanto ele tem saldo, o próximo
  // lote nem aparece; quando esgota, o próximo assume estes campos sem somar
  // com o que já foi consumido do lote anterior.
  const activeLot = (Array.isArray(input.lots) ? input.lots : []).find(
    (lot) => lot.lot_id === input.active_lot_id,
  );
  const activeLotInitialKg = activeLot && numeric(activeLot.initial_kg) ? activeLot.initial_kg : null;
  const activeLotConsumedKg = activeLot && numeric(activeLot.consumed_kg) ? activeLot.consumed_kg : null;
  const activeLotBalanceKg = activeLot && numeric(activeLot.balance_kg) ? activeLot.balance_kg : null;

  const routed: FlowStage[] = source.map((stage, index) => {
    const process = normalize(stage.tracking_name || stage.name);
    const position = traceStages.get(process);
    // O motor guarda a fila com a chave de quem VAI consumi-la. Na tela a
    // pilha pertence a quem a produziu — ela está na saída desta etapa —,
    // então saldo e composição vêm da posição da etapa SEGUINTE. O que não
    // conciliou continua vindo desta: foi apontado aqui.
    const nextStage = source[index + 1];
    const queue = nextStage
      ? traceStages.get(normalize(nextStage.tracking_name || nextStage.name))
      : undefined;
    const identifiedPieces = numeric(position?.identified_pieces) ? position!.identified_pieces : 0;
    // "unidentified_waiting_pieces" vem de um cálculo separado (Lotes de
    // Produção cadastrados manualmente) que não conhece a rastreabilidade por
    // lote de vergalhão. Quando a rastreabilidade já atribuiu a peça a um lote
    // oficial (identified_pieces), ela deixa de ser "sem lote identificado" —
    // só sobra como tal o que nenhum dos dois cálculos conseguiu explicar.
    const rawUnidentified = numeric(stage.unidentified_waiting_pieces)
      ? stage.unidentified_waiting_pieces
      : 0;
    const reconciledUnidentified = Math.max(rawUnidentified - identifiedPieces, 0);
    return {
      ...stage,
      unidentified_waiting_pieces: reconciledUnidentified,
      flow_balance: numeric(queue?.available_pieces) ? queue!.available_pieces : 0,
      flow_divergence: numeric(position?.unmatched_pieces) ? position!.unmatched_pieces : 0,
      opening_pieces: numeric(position?.opening_pieces) ? position!.opening_pieces : 0,
      identified_pieces: identifiedPieces,
      queue_opening_pieces: numeric(queue?.opening_pieces) ? queue!.opening_pieces : 0,
      queue_identified_pieces: numeric(queue?.identified_pieces) ? queue!.identified_pieces : 0,
      flow_next_name: nextStage?.tracking_name || nextStage?.name || null,
      traceability_lots: Array.isArray(queue?.lots) ? queue!.lots : [],
    };
  });

  return {
    material: {
      available: true,
      active_lot_id: input.active_lot_id || null,
      initial_kg: initialKg,
      consumed_kg: consumedKg,
      remaining_kg: remainingKg,
      blank_weight_kg: blankWeight,
      estimated_pieces: piecesFrom(initialKg, blankWeight),
      consumed_pieces: piecesFrom(consumedKg, blankWeight),
      remaining_pieces: piecesFrom(remainingKg, blankWeight),
      active_lot_initial_kg: activeLotInitialKg,
      active_lot_consumed_kg: activeLotConsumedKg,
      active_lot_balance_kg: activeLotBalanceKg,
      active_lot_remaining_pieces: piecesFrom(activeLotBalanceKg, blankWeight),
      method: input.method || "calculado",
      flow_divergence: numeric(traceability.unmatched_pieces) ? traceability.unmatched_pieces : 0,
    },
    stages: routed,
    wip: routed.reduce((total, stage) => total + (stage.flow_balance ?? 0), 0),
    divergence: numeric(traceability.unmatched_pieces) ? traceability.unmatched_pieces : 0,
    sourceStatus: traceability.source_status || {},
  };
}
