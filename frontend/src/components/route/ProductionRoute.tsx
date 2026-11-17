import type { OverviewProduct } from "../../api/types";
import { formatPieces, MISSING_LABEL } from "../../lib/formatters";
import type { FlowStage, ProductionFlow } from "../../lib/productionFlow";
import Icon from "../ui/Icon";
import MaterialOriginStage from "./MaterialOriginStage";
import styles from "./ProductionRoute.module.css";
import ProductionStage from "./ProductionStage";

interface ProductionRouteProps {
  product: OverviewProduct;
  flow: ProductionFlow;
  traceabilityError: string;
  onAudit: (stage: FlowStage) => void;
  onMaterialAudit: () => void;
}

/** Sequência operacional da peça, do Blank ao pré-acabado. */
export default function ProductionRoute({
  product,
  flow,
  traceabilityError,
  onAudit,
  onMaterialAudit,
}: ProductionRouteProps) {
  const stages = flow.stages;
  const entry = stages[0];
  const exit = stages[stages.length - 1];

  return (
    <section className={styles.route} aria-labelledby="production-route-title">
      <header className={styles.routeHead}>
        <div>
          <span className="fc-label">Rota de produção</span>
          <h2 id="production-route-title">Fluxo das operações</h2>
        </div>
        <dl className={styles.routeSummary}>
          <div>
            <dt>Entrada</dt>
            <dd className="fc-mono">{entry ? formatPieces(entry.reported) : MISSING_LABEL}</dd>
            <small>{entry ? entry.tracking_name || entry.name : "Rota não informada"}</small>
          </div>
          <div>
            <dt>Saída</dt>
            <dd className="fc-mono">{exit ? formatPieces(exit.reported) : MISSING_LABEL}</dd>
            <small>{exit ? exit.tracking_name || exit.name : "Rota não informada"}</small>
          </div>
          <div className={styles.routeSummaryProcess}>
            <dt>No chão de fábrica</dt>
            <dd className="fc-mono">{formatPieces(product.visible_wip)}</dd>
            <small>Soma do que está parado nas etapas agora</small>
          </div>
        </dl>
      </header>

      {traceabilityError ? (
        <p className={styles.routeAlert} role="alert">
          <Icon name="alert" size={18} />
          Rastreabilidade por lote indisponível: {traceabilityError} As filas FIFO aparecem como
          indisponíveis, não como zero.
        </p>
      ) : null}

      {stages.length ? (
        <ol className={styles.stages}>
          <MaterialOriginStage material={flow.material} onAudit={onMaterialAudit} />
          {stages.map((stage, index) => (
            <ProductionStage
              key={`${stage.totvs_code ?? stage.name}-${index}`}
              stage={stage}
              index={index}
              nextStageName={stage.flow_next_name}
              routeOutput={product.route_output ?? "pre_acabado"}
              onAudit={onAudit}
            />
          ))}
        </ol>
      ) : (
        <p className={styles.routeEmpty}>Esta peça ainda não tem rota operacional cadastrada.</p>
      )}
    </section>
  );
}
