import type { CatalogProduct } from "../../api/types";
import { MISSING_LABEL } from "../../lib/formatters";
import { productProgress, type InventoryPosition } from "../../lib/inventory";
import Icon from "../ui/Icon";
import StatusBadge from "../ui/StatusBadge";
import styles from "./Inventory.module.css";

interface InventorySummaryProps {
  products: CatalogProduct[];
  positions: InventoryPosition[];
  referenceLabel: string;
  unsavedCount: number;
  onlyPending: boolean;
  onTogglePending: (value: boolean) => void;
  onFocusProduct: (productId: string) => void;
}

/**
 * Revisão antes de concluir: produtos sem posição registrada continuam
 * "não informado" — nunca zero.
 */
export default function InventorySummary({
  products,
  positions,
  referenceLabel,
  unsavedCount,
  onlyPending,
  onTogglePending,
  onFocusProduct,
}: InventorySummaryProps) {
  const progress = products.map((product) => ({
    product,
    ...productProgress(product.id, positions),
  }));
  const recorded = progress.filter((row) => row.recorded);
  const pending = progress.filter((row) => !row.recorded);
  const percent = products.length ? Math.round((recorded.length / products.length) * 100) : 0;

  return (
    <section className={styles.summary} aria-labelledby="inventory-summary-title">
      <header className={styles.summaryHead}>
        <div>
          <span className="fc-label">Revisão do inventário</span>
          <h2 id="inventory-summary-title">Progresso real por produto</h2>
          <p className={styles.summaryNote}>
            Referência {referenceLabel}. Um produto só é considerado registrado quando tem ao menos
            uma posição salva com operação, quantidade e responsável.
          </p>
        </div>

        <div className={styles.summaryFigures}>
          <div className={styles.summaryFigure}>
            <span className="fc-label">Registrados</span>
            <strong className="fc-mono">
              {recorded.length}
              <small>de {products.length}</small>
            </strong>
          </div>
          <div className={styles.summaryFigure}>
            <span className="fc-label">Posições salvas</span>
            <strong className="fc-mono">
              {positions.filter((position) => position.savedKey !== null && !position.dirty).length}
            </strong>
          </div>
          <div className={styles.summaryFigure}>
            <span className="fc-label">Não salvas</span>
            <strong className={`fc-mono ${unsavedCount ? styles.summaryPending : ""}`}>{unsavedCount}</strong>
          </div>
        </div>
      </header>

      <div className={styles.progressTrack} role="img" aria-label={`${percent}% dos produtos registrados`}>
        <span className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>

      <div className={styles.summaryControls}>
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(event) => onTogglePending(event.target.checked)}
          />
          <Icon name="filter" size={18} />
          Mostrar somente produtos pendentes
        </label>
        <span className={styles.filterCount}>
          {pending.length} pendente(s) · {recorded.length} concluído(s)
        </span>
      </div>

      {pending.length ? (
        <ul className={styles.pendingList}>
          {pending.map((row) => (
            <li key={row.product.id}>
              <button type="button" className={styles.pendingItem} onClick={() => onFocusProduct(row.product.id)}>
                <span className={styles.pendingName}>{row.product.name}</span>
                <StatusBadge tone="warning">{MISSING_LABEL}</StatusBadge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.summaryDone}>
          <Icon name="check" size={18} />
          Todos os produtos têm posição registrada para {referenceLabel}.
        </p>
      )}
    </section>
  );
}
