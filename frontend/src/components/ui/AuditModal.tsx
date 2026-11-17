import { useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import Icon from "./Icon";
import styles from "./Ui.module.css";
import detailStyles from "./AuditModal.module.css";

export interface AuditDetail {
  title: string;
  source: string;
  rows: [string, string][];
  state?: "ready" | "loading" | "error";
}

interface AuditModalProps {
  detail: AuditDetail;
  onClose: () => void;
}

/** Valores calculados recebem marcação explícita, nunca se passam por oficiais. */
const CALCULATED = /calculad|estimad|indefinid|conciliaç/i;
const MISSING = /não informado|indisponível|ausente|—/i;

export default function AuditModal({ detail, onClose }: AuditModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-dialog-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            <span className={styles.dialogEyebrow}>Auditoria da operação</span>
            <h2 className={styles.dialogTitle} id="audit-dialog-title">
              {detail.title}
            </h2>
            <span className={styles.dialogSource}>Fonte: {detail.source}</span>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="Fechar auditoria">
            <Icon name="close" />
          </button>
        </header>

        <div className={styles.dialogBody}>
          {detail.state === "loading" ? (
            <p className={detailStyles.loading} role="status">
              Consultando a memória de cálculo…
            </p>
          ) : (
            <dl className={detailStyles.rows}>
              {detail.rows.map(([label, value]) => {
                const tone = MISSING.test(value)
                  ? detailStyles.missing
                  : CALCULATED.test(value)
                    ? detailStyles.calculated
                    : "";
                return (
                  <div className={`${detailStyles.row} ${tone}`} key={`${label}-${value}`}>
                    <dt className={detailStyles.term}>{label}</dt>
                    <dd className={`${detailStyles.value} fc-mono`}>{value}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>

        <footer className={styles.dialogFooter}>
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={onClose}>
            Fechar detalhes
          </button>
        </footer>
      </div>
    </div>
  );
}
