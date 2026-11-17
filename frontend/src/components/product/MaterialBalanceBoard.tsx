import type { OverviewProduct, TotvsPayload } from "../../api/types";
import { formatKgBR, formatPieces, hasNumber, MISSING_LABEL } from "../../lib/formatters";
import { estimateMaterialOutcome, transferredLotBalance } from "../../lib/materialBalance";
import type { ProductionFlow } from "../../lib/productionFlow";
import Icon from "../ui/Icon";
import styles from "./ProductWorkspace.module.css";

interface MaterialBalanceBoardProps {
  product: OverviewProduct;
  totvs: TotvsPayload | null;
  totvsLoading: boolean;
  totvsError: string;
  flow: ProductionFlow;
  onAudit: (topic: string) => void;
}

type Origin = "oficial" | "calculado" | "estimado" | "indisponivel";

interface CellProps {
  label: string;
  value: string;
  origin: Origin;
  note: string;
}

const ORIGIN_LABEL: Record<Origin, string> = {
  oficial: "Oficial",
  calculado: "Calculado",
  estimado: "Estimado",
  indisponivel: "Indisponível",
};

/** Cada valor declara a origem: oficial, calculado, estimado ou indisponível. */
function Cell({ label, value, origin, note }: CellProps) {
  return (
    <article className={`${styles.balanceCell} ${styles[`origin_${origin}`]}`}>
      <header>
        <span className="fc-label">{label}</span>
        <span className={styles.originTag}>{ORIGIN_LABEL[origin]}</span>
      </header>
      <strong className={`${styles.balanceValue} fc-mono`}>{value}</strong>
      <small className={styles.balanceNote}>{note}</small>
    </article>
  );
}

export default function MaterialBalanceBoard({
  product,
  totvs,
  totvsLoading,
  totvsError,
  flow,
  onAudit,
}: MaterialBalanceBoardProps) {
  const stock = hasNumber(totvs?.stock?.total_kg) ? totvs!.stock.total_kg : null;
  const transferred = hasNumber(totvs?.transferred_kg) ? totvs!.transferred_kg : null;
  const transferBalance = transferredLotBalance(totvs?.lots);
  const stockEstimate = estimateMaterialOutcome(stock, product.blank_weight_kg, product.stages);
  const transferEstimate = estimateMaterialOutcome(transferBalance, product.blank_weight_kg, product.stages);

  const consumptionOfficial = product.consumption_connected === true && hasNumber(product.consumed_kg);
  const consumedCalculated = flow.material.available ? flow.material.consumed_kg : null;
  const remainingCalculated = flow.material.available ? flow.material.active_lot_balance_kg : null;

  const planning = product.planning_connected === true;

  return (
    <section className={styles.panel} aria-labelledby="material-balance-title">
      <header className={styles.panelHead}>
        <div>
          <span className="fc-label">Balanço do vergalhão</span>
          <h2 id="material-balance-title">Do estoque ao resultado da produção</h2>
          <p className={styles.panelNote}>
            Estoque e transferência vêm do TOTVS; produção e perdas vêm dos Apontamentos. Ausência de
            integração não vira zero.
          </p>
        </div>
        <button type="button" className={styles.auditButton} onClick={() => onAudit("estimate")}>
          <Icon name="scale" size={18} />
          Memória de cálculo
        </button>
      </header>

      {totvsError ? (
        <p className={styles.panelAlert} role="alert">
          <Icon name="critical" size={18} />
          Consulta ao TOTVS indisponível: {totvsError} Nenhum saldo foi presumido.
        </p>
      ) : null}

      <div className={styles.balanceBand}>
        <h3 className={styles.bandTitle}>Origem · Armazém {totvs?.stock?.warehouse ?? "01"}</h3>
        <div className={styles.balanceGrid}>
          <Cell
            label="Saldo oficial em estoque"
            value={totvsLoading && !totvs ? "Consultando…" : formatKgBR(stock)}
            origin={stock === null ? "indisponivel" : "oficial"}
            note={totvs?.message || "TOTVS · SB2010"}
          />
          <Cell
            label="Capacidade pelo estoque"
            value={stockEstimate ? `${formatPieces(stockEstimate.pieces)} peças` : MISSING_LABEL}
            origin={stockEstimate ? "estimado" : "indisponivel"}
            note="Estimado pelo peso do Blank"
          />
          <Cell
            label="Sucata estimada no processo"
            value={stockEstimate ? formatKgBR(stockEstimate.scrapKg) : MISSING_LABEL}
            origin={stockEstimate ? "estimado" : "indisponivel"}
            note="Reduções de peso declaradas por etapa"
          />
        </div>
      </div>

      <div className={styles.balanceBand}>
        <h3 className={styles.bandTitle}>Transferência para a peça</h3>
        <div className={styles.balanceGrid}>
          <Cell
            label="Transferido oficialmente"
            value={formatKgBR(transferred)}
            origin={transferred === null ? "indisponivel" : "oficial"}
            note="TOTVS · SD3010 · número de série"
          />
          <Cell
            label="Saldo calculado dos lotes"
            value={formatKgBR(transferBalance)}
            origin={transferBalance === null ? "indisponivel" : "calculado"}
            note="Transferido menos consumo projetado por lote"
          />
          <Cell
            label="Capacidade pelo saldo transferido"
            value={transferEstimate ? `${formatPieces(transferEstimate.pieces)} peças` : MISSING_LABEL}
            origin={transferEstimate ? "estimado" : "indisponivel"}
            note="Estimado pelo peso do Blank"
          />
        </div>
      </div>

      <div className={styles.balanceBand}>
        <h3 className={styles.bandTitle}>Consumo e resultado</h3>
        <div className={styles.balanceGrid}>
          <Cell
            label={consumptionOfficial ? "Consumo oficial" : "Consumo calculado"}
            value={
              consumptionOfficial
                ? formatKgBR(product.consumed_kg)
                : consumedCalculated === null
                  ? MISSING_LABEL
                  : formatKgBR(consumedCalculated)
            }
            origin={
              consumptionOfficial ? "oficial" : consumedCalculated === null ? "indisponivel" : "calculado"
            }
            note={
              consumptionOfficial
                ? "Baixa oficial vinculada ao lote"
                : consumedCalculated === null
                  ? "Integração de consumo por lote ainda não conectada"
                  : "Projeção FIFO da rastreabilidade"
            }
          />
          <Cell
            label={consumptionOfficial ? "Saldo oficial do lote" : "Saldo calculado do lote"}
            value={remainingCalculated === null ? MISSING_LABEL : formatKgBR(remainingCalculated)}
            origin={remainingCalculated === null ? "indisponivel" : consumptionOfficial ? "oficial" : "calculado"}
            note={flow.material.active_lot_id ? `Lote ${flow.material.active_lot_id}` : "Lote ativo não identificado"}
          />
          <Cell
            label="Peças produzidas"
            value={product.last_production_date ? `${formatPieces(product.actual_pieces)} peças` : MISSING_LABEL}
            origin={product.last_production_date ? "oficial" : "indisponivel"}
            note={product.last_production_date ? "Apontamentos do período" : "Sem apontamentos no período"}
          />
          <Cell
            label="Sucata produzida"
            value={product.last_production_date ? formatKgBR(product.actual_scrap_kg) : MISSING_LABEL}
            origin={product.last_production_date ? "calculado" : "indisponivel"}
            note="Perdas apontadas e reduções de peso"
          />
          <Cell
            label="Quantidade faltante"
            value={planning ? formatKgBR(product.shortage_kg) : MISSING_LABEL}
            origin={planning ? "calculado" : "indisponivel"}
            note={planning ? "Necessidade planejada menos estoque" : "PCP ainda não conectado"}
          />
          <Cell
            label="Lotes de material"
            value={hasNumber(totvs?.lot_count) ? formatPieces(totvs!.lot_count) : MISSING_LABEL}
            origin={hasNumber(totvs?.lot_count) ? "oficial" : "indisponivel"}
            note="Cada transferência identificada forma um lote"
          />
        </div>
      </div>
    </section>
  );
}
