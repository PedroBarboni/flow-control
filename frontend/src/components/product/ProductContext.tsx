import type { OverviewProduct } from "../../api/types";
import { periods } from "../../lib/controlCalendar";
import { formatDateBR, formatKgBR, MISSING_LABEL } from "../../lib/formatters";
import { materialDescription, officialCode } from "../../lib/products";
import Icon from "../ui/Icon";
import styles from "./ProductWorkspace.module.css";

interface ProductContextProps {
  product: OverviewProduct;
  period: string;
  onPeriodChange: (period: string) => void;
  materialLotId: string | null;
  remainingRodKg: number | null;
  onBack: () => void;
  onOpenLots: () => void;
}

/**
 * Barra de contexto: produto, material e período permanecem visíveis e são
 * preservados ao abrir detalhes ou trocar de aba.
 */
export default function ProductContext({
  product,
  period,
  onPeriodChange,
  materialLotId,
  remainingRodKg,
  onBack,
  onOpenLots,
}: ProductContextProps) {
  return (
    <section className={styles.context} aria-label="Contexto do controle">
      <div className={styles.contextIdentity}>
        <button type="button" className={styles.back} onClick={onBack}>
          <Icon name="arrowLeft" size={18} />
          Trocar peça
        </button>
        <div>
          <span className="fc-label">Peça selecionada</span>
          <h1 className={styles.contextName}>{product.name}</h1>
          <p className={styles.contextMeta}>
            <span className="fc-mono">CÓDIGO: {officialCode(product) || MISSING_LABEL}</span>
            <span aria-hidden="true">·</span>
            <span>{materialDescription(product)}</span>
          </p>
        </div>
      </div>

      <div className={styles.contextControls}>
        <label className={styles.contextField}>
          <span className="fc-label">Período</span>
          <select value={period} onChange={(event) => onPeriodChange(event.target.value)}>
            {periods.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.contextField}>
          <span className="fc-label">Lote oficial do vergalhão</span>
          <strong className={`${styles.contextValue} fc-mono`}>
            {materialLotId || "Identificação ausente"}
          </strong>
        </div>

        <div className={styles.contextField}>
          <span className="fc-label">Vergalhão restante no lote</span>
          <strong className={`${styles.contextValue} fc-mono`}>
            {remainingRodKg === null ? MISSING_LABEL : `≈ ${formatKgBR(remainingRodKg)} · calculado`}
          </strong>
        </div>

        <div className={styles.contextField}>
          <span className="fc-label">Último apontamento</span>
          <strong className={`${styles.contextValue} fc-mono`}>
            {product.last_production_date ? formatDateBR(product.last_production_date) : "Sem apontamentos"}
          </strong>
        </div>

        <button type="button" className={styles.contextLink} onClick={onOpenLots}>
          Lotes desta peça
          <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </section>
  );
}
