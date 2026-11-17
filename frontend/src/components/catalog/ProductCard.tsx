import type { CatalogProduct, CatalogProductionRow } from "../../api/types";
import { formatPieces, MISSING_LABEL } from "../../lib/formatters";
import { materialDescription, officialCode } from "../../lib/products";
import Icon from "../ui/Icon";
import styles from "./ProductCatalog.module.css";

interface ProductCardProps {
  product: CatalogProduct;
  production?: CatalogProductionRow;
  /** Falso enquanto a produção agregada ainda não respondeu. */
  productionAvailable: boolean;
  onSelect: (productId: string) => void;
}

interface FigureProps {
  label: string;
  value: number | null | undefined;
  available: boolean;
  tone?: "produced" | "process";
  note?: string;
}

/**
 * Número operacional do card.
 *
 * Zero oficial aparece como `0`. Valor não disponível aparece como
 * "Não informado" — jamais convertido em zero.
 */
function Figure({ label, value, available, tone = "produced", note }: FigureProps) {
  const known = available && typeof value === "number" && Number.isFinite(value);
  return (
    <div className={`${styles.figure} ${tone === "process" ? styles.figureProcess : ""}`}>
      <span className={styles.figureLabel}>{label}</span>
      {known ? (
        <strong className={`${styles.figureValue} fc-mono`}>
          {formatPieces(value)}
          <small>peças</small>
        </strong>
      ) : (
        <strong className={`${styles.figureValue} ${styles.figureMissing}`}>{MISSING_LABEL}</strong>
      )}
      {note ? <span className={styles.figureNote}>{note}</span> : null}
    </div>
  );
}

export default function ProductCard({
  product,
  production,
  productionAvailable,
  onSelect,
}: ProductCardProps) {
  const name = product.name || "Peça sem identificação";
  const code = officialCode(product);
  const unidentified = production?.unidentified_in_process_pieces ?? 0;
  const hasDivergence = productionAvailable && unidentified > 0;
  const identifiedLot = productionAvailable ? production?.material_lot_id : null;
  const critical = productionAvailable && production?.critical === true;
  const attention = productionAvailable && production?.attention === true;

  const stateClass = critical
    ? styles.cardCritical
    : attention || hasDivergence
      ? styles.cardAttention
      : "";

  return (
    <button
      type="button"
      className={`${styles.card} ${stateClass}`}
      onClick={() => onSelect(product.id)}
      aria-label={`Abrir controle de ${name}`}
    >
      <span className={styles.cardHead}>
        <strong className={styles.cardName}>{name}</strong>
        {/* Código e material na mesma linha: é assim que o operador identifica a peça. */}
        <span className={styles.cardCode}>
          CÓDIGO: {code || MISSING_LABEL.toUpperCase()} · {materialDescription(product)}
        </span>
      </span>

      <span className={styles.cardFigures}>
        <Figure
          label="Já produzido"
          value={production?.produced_pieces}
          available={productionAvailable}
        />
        <Figure
          label="Em processo"
          value={production?.in_process_pieces}
          available={productionAvailable}
          tone="process"
          note={
            hasDivergence
              ? `${formatPieces(unidentified)} sem lote identificado`
              : identifiedLot
                ? `Lote ${identifiedLot}`
                : undefined
          }
        />
      </span>

      {critical || attention || hasDivergence ? (
        <span className={`${styles.cardAlert} ${critical ? styles.cardAlertCritical : ""}`}>
          <Icon name={critical ? "critical" : "alert"} size={16} />
          {critical
            ? "Perda crítica apontada em uma operação"
            : hasDivergence
              ? "Divergência entre operações sem lote identificado"
              : "Perda acima do esperado em uma operação"}
        </span>
      ) : null}

      <span className={styles.cardAction}>
        Abrir controle
        <Icon name="arrowRight" size={18} />
      </span>
    </button>
  );
}
