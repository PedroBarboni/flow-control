import { formatKgBR, formatPieces, MISSING_LABEL } from "../../lib/formatters";
import type { FlowMaterial } from "../../lib/productionFlow";
import Icon from "../ui/Icon";
import styles from "./ProductionRoute.module.css";

interface MaterialOriginStageProps {
  material: FlowMaterial;
  onAudit: () => void;
}

/** Etapa 0: saldo de vergalhão que abastece a primeira operação da rota. */
export default function MaterialOriginStage({ material, onAudit }: MaterialOriginStageProps) {
  const initial = material.active_lot_initial_kg;
  const consumed = material.active_lot_consumed_kg;
  // Percentual só existe com os dois valores reais; sem eles, nada de barra.
  const consumedShare =
    initial !== null && consumed !== null && initial > 0
      ? Math.min(Math.max(consumed / initial, 0), 1)
      : null;

  return (
    <li
      className={`${styles.stage} ${styles.stageMaterial} ${
        styles[material.available ? "stage_normal" : "stage_empty"]
      }`}
    >
      <div className={styles.stageIndex} aria-hidden="true">
        00
      </div>

      <div className={styles.stageIdentity}>
        <span className={styles.stageCode}>VERGALHÃO</span>
        <h3 className={styles.stageName}>Vergalhão</h3>
        <span className={styles.stageMachine}>
          {material.active_lot_id ? `Lote ${material.active_lot_id}` : "Lote ativo não identificado"}
        </span>
        <span className={`${styles.stageStatus} ${styles[material.available ? "status_normal" : ""] ?? ""}`}>
          <Icon name={material.available ? "check" : "info"} size={16} />
          {material.available ? "Calculado" : "Sem dados"}
        </span>
      </div>

      <dl className={styles.stageStats}>
        <div>
          <dt>Saldo restante do lote</dt>
          <dd className="fc-mono">
            {material.active_lot_balance_kg === null
              ? MISSING_LABEL
              : formatKgBR(material.active_lot_balance_kg)}
          </dd>
          <small>Só o lote ativo · destino Corte</small>
        </div>
        <div>
          <dt>Peças estimadas</dt>
          <dd className="fc-mono">
            {material.active_lot_remaining_pieces === null
              ? MISSING_LABEL
              : `${formatPieces(material.active_lot_remaining_pieces)} peças`}
          </dd>
          <small>Pelo peso do Blank</small>
        </div>
        <div>
          <dt>Consumido deste lote</dt>
          <dd className="fc-mono">
            {material.active_lot_consumed_kg === null
              ? MISSING_LABEL
              : formatKgBR(material.active_lot_consumed_kg)}
          </dd>
          <small>Corte já apontado neste lote</small>
        </div>
        <div>
          <dt>Recebido neste lote</dt>
          <dd className="fc-mono">
            {material.active_lot_initial_kg === null
              ? MISSING_LABEL
              : formatKgBR(material.active_lot_initial_kg)}
          </dd>
          <small>Quando este lote esgotar, o próximo assume sozinho</small>
        </div>
      </dl>

      <button type="button" className={styles.stageAudit} onClick={onAudit}>
        Abrir detalhes
        <Icon name="arrowRight" size={16} />
      </button>

      {consumedShare !== null ? (
        <div className={styles.stageProgress}>
          <div className={styles.stageProgressTrack}>
            <div className={styles.stageProgressFill} style={{ width: `${Math.round(consumedShare * 100)}%` }} />
          </div>
          <div className={styles.stageProgressNote}>
            <span>{`${(consumedShare * 100).toFixed(1).replace(".", ",")}% consumido`}</span>
            <span>{material.active_lot_id ? `Lote ${material.active_lot_id}` : ""}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}
