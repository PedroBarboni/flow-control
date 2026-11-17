import type { TotvsPayload, TraceabilityPayload } from "../../api/types";
import { formatKgBR, formatPieces, hasNumber, MISSING_LABEL } from "../../lib/formatters";
import Icon from "../ui/Icon";
import styles from "./ProductWorkspace.module.css";

interface MaterialTraceRailProps {
  totvs: TotvsPayload | null;
  totvsLoading: boolean;
  materialLotId: string | null;
  traceability: TraceabilityPayload | null;
  onAudit: (topic: string) => void;
}

/** Transferências identificadas: identificador curto, documento e destino preservados. */
export default function MaterialTraceRail({
  totvs,
  totvsLoading,
  materialLotId,
  traceability,
  onAudit,
}: MaterialTraceRailProps) {
  const lots = Array.isArray(totvs?.lots) ? totvs!.lots : [];

  return (
    <section className={styles.panel} aria-labelledby="material-trace-title">
      <header className={styles.panelHead}>
        <div>
          <span className="fc-label">Lotes identificados</span>
          <h2 id="material-trace-title">Transferências destinadas a esta peça</h2>
          <p className={styles.panelNote}>
            Movimentações anteriores a 01/09/2026 não criam lotes oficiais. Fardos não recebem
            identificação individual.
          </p>
        </div>
        <button type="button" className={styles.auditButton} onClick={() => onAudit("transfer")}>
          <Icon name="package" size={18} />
          Auditar transferência
        </button>
      </header>

      {totvsLoading && !totvs ? (
        <p className={styles.panelLoading} role="status">
          Consultando o TOTVS…
        </p>
      ) : lots.length ? (
        <div className={styles.traceGrid}>
          {lots.map((lot) => {
            const recognized = traceability?.material.lots.find((row) => row.lot_id === lot.id);
            return (
            <article
              key={`${lot.id}-${lot.document}`}
              className={`${styles.traceCard} ${lot.id === materialLotId ? styles.traceCardActive : ""}`}
            >
              <header>
                <span className="fc-label">Lote oficial</span>
                <strong className="fc-mono">{lot.id}</strong>
              </header>
              <dl>
                <div>
                  <dt>Peso transferido</dt>
                  <dd className="fc-mono">{formatKgBR(lot.initial_kg)}</dd>
                </div>
                <div>
                  <dt>{recognized ? "Saldo calculado" : "Saldo do lote"}</dt>
                  <dd className="fc-mono">
                    {formatKgBR(recognized?.balance_kg ?? lot.balance_kg)}
                  </dd>
                </div>
                <div>
                  <dt>Blanks transformados</dt>
                  <dd className="fc-mono">
                    {hasNumber(recognized?.transformed_pieces)
                      ? `${formatPieces(recognized.transformed_pieces)} peças`
                      : MISSING_LABEL}
                  </dd>
                </div>
                <div>
                  <dt>Perdas no blank</dt>
                  <dd className="fc-mono">
                    {hasNumber(recognized?.loss_pieces)
                      ? `${formatPieces(recognized.loss_pieces)} perdas`
                      : MISSING_LABEL}
                  </dd>
                </div>
                <div>
                  <dt>Material consumido</dt>
                  <dd className="fc-mono">
                    {hasNumber(recognized?.consumed_kg)
                      ? formatKgBR(recognized.consumed_kg)
                      : MISSING_LABEL}
                  </dd>
                </div>
                <div>
                  <dt>Data</dt>
                  <dd className="fc-mono">{lot.date || MISSING_LABEL}</dd>
                </div>
                <div>
                  <dt>Documento TOTVS</dt>
                  <dd className="fc-mono">{lot.document || MISSING_LABEL}</dd>
                </div>
                <div>
                  <dt>Código da peça</dt>
                  <dd className="fc-mono">{lot.destination || MISSING_LABEL}</dd>
                </div>
              </dl>
              {recognized ? (
                <p className={styles.traceCalculation}>
                  Calculado por apontamentos desde {traceability?.history_period?.from ?? "o início do lote"}.
                </p>
              ) : null}
            </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.panelEmpty}>
          Nenhuma transferência identificada para esta peça no controle atual.
        </p>
      )}
    </section>
  );
}
