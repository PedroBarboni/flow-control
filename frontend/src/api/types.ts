/** Contratos de leitura da API Flow Control. Nada aqui inventa dado ausente. */

export type Nullable<T> = T | null | undefined;

export interface TrackingStage {
  code: string;
  stage: string;
  process: string;
  weight_kg: number;
  machine: string | null;
  scrap_to_next_kg_per_piece: number;
}

/**
 * O que a última operação da rota entrega. `pre_acabado` na maioria — a
 * operação muda por família (Laminação, Usinagem, Solda) mas é sempre a
 * última. `componente` na Eixo, que não vira pré-acabada: sai da Laminação
 * e vai para a Solda ser unida ao Placa.
 */
export type RouteOutput = "pre_acabado" | "componente";

export interface CatalogProduct {
  id: string;
  name: string;
  code: string;
  route_output: RouteOutput;
  rod: string;
  rod_diameter_mm: string | null;
  rod_available: boolean | null;
  rod_material: string | null;
  stages: string[];
  totvs_destination_codes: string[];
  totvs_destination_code_stages: Record<string, string>;
  tracking_stages: TrackingStage[];
  blank_weight_kg: number | null;
  pieces_per_kg: number | null;
  status: string;
}

/** Situação produtiva agregada usada nos cards tipográficos do catálogo. */
export interface CatalogProductionRow {
  product_id: string;
  produced_pieces: number | null;
  in_process_pieces: number | null;
  identified_in_process_pieces: number | null;
  unidentified_in_process_pieces: number | null;
  material_lot_id?: string | null;
  production_lot_id?: string | null;
  last_production_date: string | null;
  attention: boolean;
  critical: boolean;
}

export interface CatalogProductionPayload {
  period: { from: string; to: string };
  source: string;
  available: boolean;
  message: string;
  rows: CatalogProductionRow[];
}

export interface StageRow {
  name: string;
  machine: string;
  reported: number | null;
  loss: number | null;
  waiting: number | null;
  status: "empty" | "normal" | "attention" | "critical" | string;
  tracking_name?: string;
  totvs_stage?: string;
  totvs_code?: string;
  unit_weight_kg?: number | null;
  scrap_to_next_kg_per_piece?: number | null;
  last_date?: string | null;
  awaiting_pieces?: number | null;
  guarded_pieces?: number | null;
  in_process_pieces?: number | null;
  rejection_scrap_kg?: number | null;
  process_scrap_kg?: number | null;
  total_scrap_kg?: number | null;
  unidentified_waiting_pieces?: number | null;
  awaiting_pieces_total?: number | null;
}

export interface UnidentifiedLot {
  lot_id: string;
  position_key: string;
  product_id: string;
  product_name: string;
  material_lot_id: string;
  previous_process: string;
  current_process: string;
  quantity_pieces: number;
  rod_kg: number | null;
  status: string;
  hold_reason: string;
  unidentified: true;
}

export interface OverviewProduct extends Omit<CatalogProduct, "stages"> {
  database_name: string;
  stages: StageRow[];
  wallet: number;
  finished: number;
  warehouse_kg: number;
  required_kg: number;
  transferred_kg: number;
  consumed_kg: number;
  estimated_pieces: number;
  actual_pieces: number;
  estimated_scrap_kg: number;
  actual_scrap_kg: number;
  wip: number;
  visible_wip: number;
  unidentified_wip: number;
  unidentified_lots: UnidentifiedLot[];
  prefinished: number;
  yield_percent: number;
  planning_connected: boolean;
  consumption_connected: boolean;
  shortage_kg: number;
  uncovered_wallet: number;
  coverage_percent: number;
  production_source: string;
  production_period: { from: string | null; to: string | null };
  last_production_date: string | null;
}

export interface Integration {
  name: string;
  status: string;
  latency?: string;
  detail?: string;
  message?: string;
}

export interface OverviewPayload {
  system_name: string;
  updated_at: string;
  integrations: Integration[];
  totals: {
    wallet: number;
    finished: number;
    wip: number;
    warehouse_kg: number;
    critical_alerts: number;
  };
  product: OverviewProduct | null;
}

export interface InventoryRowPayload {
  product_id: string;
  product_name: string;
  process: string;
  position_status: "waiting" | "in_process" | "completed" | string;
  piece_quantity: number;
  rod_kg_in_process: number | null;
  operator_name: string;
  notes: string;
  updated_at: string | null;
  reference_date: string | null;
}

export interface InventoryPayload {
  reference_date: string;
  reference_date_label: string;
  rows: InventoryRowPayload[];
  recorded_positions: number;
  recorded_products: number;
  total_products: number;
  pending_product_ids: string[];
  ready: boolean;
  locked?: boolean;
  lock_message?: string;
}

export interface InventorySavePayload {
  process: string;
  position_status: "waiting" | "in_process" | "completed";
  piece_quantity: number;
  rod_kg_in_process: number | null;
  operator_name: string;
  notes: string;
}

export interface MaterialLotRow {
  id: string;
  material_code: string;
  initial_kg: number;
  balance_kg: number;
  status: string;
  date: string;
  document: string;
  destination: string;
  destination_stage?: string | null;
  production_order?: string;
  user?: string;
  source_record?: number;
}

export interface TotvsPayload {
  status: "online" | "offline" | string;
  message: string;
  updated_at?: string;
  control?: Record<string, unknown>;
  material?: {
    codes: string[];
    description: string;
    unit: string;
    diameter_mm: string | null;
  };
  destination?: {
    requested_code: string | null;
    requested_codes: string[];
    requested_name: string;
    resolved_codes: string[];
    field: string;
  };
  stock: {
    warehouse: string;
    total_kg: number;
    balances: unknown[];
    blank_weight_kg?: number;
    estimated_pieces?: number;
  };
  lots: MaterialLotRow[];
  movements: unknown[];
  transferred_kg?: number;
  lot_count?: number;
}

export interface TraceabilityStageLot {
  lot_id: string;
  process: string;
  pieces: number;
  origin_type: string;
  material_lot_id: string | null;
  route_key: string;
}

export interface TraceabilityStage {
  process: string;
  available_pieces: number;
  identified_pieces: number;
  opening_pieces: number;
  unmatched_pieces: number;
  lots: TraceabilityStageLot[];
}

export interface TraceabilityUnmatched {
  source_key: string;
  process: string;
  pieces: number;
  reason: string;
}

export interface TraceabilityPayload {
  product_id: string;
  material: {
    active_lot_id: string | null;
    initial_kg: number | null;
    consumed_kg: number | null;
    remaining_kg: number | null;
    method: string;
    lots: {
      lot_id: string;
      initial_kg: number;
      balance_kg: number;
      consumed_kg: number;
      transformed_pieces: number;
      loss_pieces: number;
    }[];
  };
  stages: TraceabilityStage[];
  unmatched_pieces: number;
  unmatched: TraceabilityUnmatched[];
  source_status: Record<string, string>;
  controls?: {
    material_consumption_locked: boolean;
    material_consumption_locked_from: string | null;
  };
  period?: { from: string; to: string };
  history_period?: { from: string; to: string };
  updated_at?: string;
}

export interface ReadinessPayload {
  ready: boolean;
  operational: boolean;
  mode: string;
  starts_at_label: string;
  inventory_at: string;
  inventory_at_label: string;
  inventory_required: boolean;
  checks: Record<string, string>;
  errors: string[];
}

export interface DetailPayload {
  title: string;
  source: string;
  rows: [string, string][];
}

export type DivergenceSeverity = "critical" | "attention";

/**
 * `acao` pede alguém: algo não fecha e tem o que investigar.
 * `origem` é a condição de partida do controle — peça produzida antes de
 * existir transferência de vergalhão nunca vai ter lote a atribuir.
 */
export type DivergenceClass = "acao" | "origem";

export interface DivergenceItem {
  product_id: string;
  product_name: string;
  kind: string;
  classe: DivergenceClass;
  severity: DivergenceSeverity;
  reference: string;
  quantity: number | null;
  unit: "kg" | "peças" | null;
  reason: string;
  /**
   * O que foi APURADO nesta peça — data, números e onde as peças estão
   * paradas. Vazio quando não há como apurar; aí valem só as hipóteses.
   */
  diagnosis: string[];
  possible_causes: string[];
}

export interface DivergencesPayload {
  generated_at: string;
  items: DivergenceItem[];
  critical_count: number;
  attention_count: number;
  action_count: number;
  origin_count: number;
  origin_pieces: number;
}

export type MaterialLotStatus = "fechado" | "em_processo" | "consumido";

export interface MaterialLotItem {
  product_id: string;
  product_name: string;
  lot_id: string;
  status: MaterialLotStatus;
  initial_kg: number;
  balance_kg: number;
  consumed_kg: number;
  produced_pieces: number;
  loss_pieces: number;
  blank_weight_kg: number | null;
  document: string | null;
  date: string | null;
}

export interface MaterialLotsPayload {
  generated_at: string;
  items: MaterialLotItem[];
  counts: Record<MaterialLotStatus, number>;
}

/**
 * Uma linha do histórico imutável. Nunca é alterada depois de gravada —
 * correção é linha nova, então a lista é a prova do que o sistema decidiu.
 */
export interface MovementItem {
  id: number;
  source_key: string;
  sequence: number;
  movement_type: "consumo_vergalhao" | "etapa" | "sem_conciliacao" | string;
  process: string;
  next_process: string | null;
  material_lot_id: string | null;
  production_lot_id: string | null;
  origin_type: string | null;
  good_pieces: number;
  loss_pieces: number;
  consumed_kg: number;
  machine: string | null;
  operator_name: string | null;
  shift: string | null;
  reason: string | null;
  occurred_at: string | null;
  recorded_at: string | null;
}

export interface MovementsPayload {
  product_id: string;
  product_name: string;
  items: MovementItem[];
  summary: {
    total: number;
    first_occurred_at: string | null;
    last_occurred_at: string | null;
    last_recorded_at: string | null;
  };
  next_before_id: number | null;
  /** Vazio quando o histórico está em dia; mensagem quando a fonte falhou. */
  stale_reason: string;
}
