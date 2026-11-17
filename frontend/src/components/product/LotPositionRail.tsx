import type { OverviewProduct } from "../../api/types";
import { formatKgBR, formatPieces, MISSING_LABEL } from "../../lib/formatters";
import type { ProductionFlow } from "../../lib/productionFlow";
import StatusBadge from "../ui/StatusBadge";
import styles from "./ProductWorkspace.module.css";

interface LotPositionRailProps {
  product: OverviewProduct;
  flow: ProductionFlow;
}

/**
 * Posição dos lotes e WIP.
 *
 * Mostra o saldo calculado entre operações que a rastreabilidade ainda não
 * conseguiu conciliar com um lote de vergalhão — nunca apresentado como lote
 * identificado.
 */
export default function LotPositionRail({ product, flow }: LotPositionRailProps) {
  const derived = product.unidentified_lots ?? [];

  return (
    <section className={styles.panel} aria-labelledby="lot-position-title">
      <header className={styles.panelHead}>
        <div>
          <span className="fc-label">Posição dos lotes e WIP</span>
          <h2 id="lot-position-title">Onde as peças estão agora</h2>
        </div>
        <div className={styles.panelFigures}>
          <div className={styles.panelFigure}>
            <span className="fc-label">WIP identificado</span>
            <strong className="fc-mono">{formatPieces(product.wip)}</strong>
          </div>
          <div className={`${styles.panelFigure} ${styles.panelFigureAttention}`}>
            <span className="fc-label">Saldo sem lote</span>
            <strong className="fc-mono">{formatPieces(product.unidentified_wip)}</strong>
          </div>
          <div className={`${styles.panelFigure} ${styles.panelFigureProcess}`}>
            <span className="fc-label">WIP total visível</span>
            <strong className="fc-mono">{formatPieces(product.visible_wip)}</strong>
          </div>
          <div className={styles.panelFigure}>
            <span className="fc-label">Divergência da rastreabilidade</span>
            <strong className="fc-mono">
              {flow.divergence === null ? MISSING_LABEL : formatPieces(flow.divergence)}
            </strong>
          </div>
        </div>
      </header>

      <div className={styles.lotRail}>
        {derived.map((lot) => (
          <article key={lot.position_key} className={`${styles.lotChip} ${styles.lotChipDerived}`}>
            <span className={styles.lotChipHead}>
              <span className="fc-label">Saldo calculado</span>
              <StatusBadge tone="warning">Aguardando conciliação</StatusBadge>
            </span>
            <strong className={`${styles.lotChipId} fc-mono`}>Identificação ausente</strong>
            <span className={styles.lotChipData}>
              <b>
                {lot.previous_process} → {lot.current_process}
              </b>
              <span className="fc-mono">{formatPieces(lot.quantity_pieces)} peças</span>
              <span className="fc-mono">{formatKgBR(lot.rod_kg)}</span>
            </span>
          </article>
        ))}

        {!derived.length ? (
          <p className={styles.emptyRail}>
            Nenhuma posição sem lote identificado para o período e a peça selecionados.
          </p>
        ) : null}
      </div>
    </section>
  );
}
