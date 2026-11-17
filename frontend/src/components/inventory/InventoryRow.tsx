import { useId } from "react";
import type { CatalogProduct } from "../../api/types";
import { formatDateTimeBR } from "../../lib/formatters";
import {
  POSITION_STATUS_LABEL,
  type InventoryPosition,
  type PositionErrors,
  type PositionStatus,
} from "../../lib/inventory";
import Icon from "../ui/Icon";
import StatusBadge from "../ui/StatusBadge";
import styles from "./Inventory.module.css";

interface InventoryRowProps {
  product: CatalogProduct;
  position: InventoryPosition;
  errors: PositionErrors;
  showErrors: boolean;
  saving: boolean;
  readOnly?: boolean;
  onChange: (key: string, patch: Partial<InventoryPosition>) => void;
  onSave: (key: string) => void;
  onDiscard: (key: string) => void;
}

const STATUS_OPTIONS: PositionStatus[] = ["waiting", "in_process"];

export default function InventoryRow({
  product,
  position,
  errors,
  showErrors,
  saving,
  readOnly = false,
  onChange,
  onSave,
  onDiscard,
}: InventoryRowProps) {
  const id = useId();
  const locked = readOnly || position.savedKey !== null;
  const field = (name: string) => `${id}-${name}`;
  const errorId = (name: string) => `${id}-${name}-erro`;

  const patch = (values: Partial<InventoryPosition>) =>
    onChange(position.key, { ...values, dirty: true });

  return (
    <li className={`${styles.position} ${position.dirty ? styles.positionDirty : ""}`}>
      <div className={styles.positionHead}>
        <span className={styles.positionTitle}>
          Posição · {position.process || "operação não definida"}
        </span>
        {position.savedKey === null ? (
          <StatusBadge tone="warning">Não salvo</StatusBadge>
        ) : position.dirty ? (
          <StatusBadge tone="warning">Alterado</StatusBadge>
        ) : (
          <StatusBadge tone="success" detail={`Salvo em ${formatDateTimeBR(position.savedAt)}`}>
            Salvo
          </StatusBadge>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={field("process")}>Operação atual</label>
          <select
            id={field("process")}
            value={position.process}
            disabled={locked}
            aria-invalid={showErrors && Boolean(errors.process)}
            aria-describedby={showErrors && errors.process ? errorId("process") : undefined}
            onChange={(event) => patch({ process: event.target.value })}
          >
            <option value="">Selecione a operação</option>
            {product.tracking_stages.map((stage) => (
              <option key={stage.code} value={stage.process}>
                {stage.process} · {stage.code}
              </option>
            ))}
          </select>
          {showErrors && errors.process ? (
            <p className={styles.error} id={errorId("process")}>
              {errors.process}
            </p>
          ) : null}
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Situação</legend>
          <div className={styles.choices}>
            {STATUS_OPTIONS.map((status) => (
              <label
                key={status}
                className={`${styles.choice} ${position.positionStatus === status ? styles.choiceActive : ""} ${
                  locked ? styles.choiceLocked : ""
                }`}
              >
                <input
                  type="radio"
                  name={field("status")}
                  value={status}
                  checked={position.positionStatus === status}
                  disabled={locked}
                  onChange={() => patch({ positionStatus: status })}
                />
                {POSITION_STATUS_LABEL[status]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={field("pieces")}>Quantidade de peças</label>
          <input
            id={field("pieces")}
            className="fc-mono"
            inputMode="decimal"
            value={position.pieceQuantity}
            disabled={readOnly}
            placeholder="Ex.: 1280"
            aria-invalid={showErrors && Boolean(errors.pieceQuantity)}
            aria-describedby={showErrors && errors.pieceQuantity ? errorId("pieces") : undefined}
            onChange={(event) => patch({ pieceQuantity: event.target.value })}
          />
          {showErrors && errors.pieceQuantity ? (
            <p className={styles.error} id={errorId("pieces")}>
              {errors.pieceQuantity}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor={field("rod")}>Kg de vergalhão em processo</label>
          <input
            id={field("rod")}
            className="fc-mono"
            inputMode="decimal"
            value={position.rodKg}
            disabled={readOnly}
            placeholder="Ex.: 128,500"
            aria-invalid={showErrors && Boolean(errors.rodKg)}
            aria-describedby={showErrors && errors.rodKg ? errorId("rod") : undefined}
            onChange={(event) => patch({ rodKg: event.target.value })}
          />
          {showErrors && errors.rodKg ? (
            <p className={styles.error} id={errorId("rod")}>
              {errors.rodKg}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor={field("operator")}>Responsável pela contagem</label>
          <input
            id={field("operator")}
            value={position.operatorName}
            disabled={readOnly}
            placeholder="Nome de quem contou"
            aria-invalid={showErrors && Boolean(errors.operatorName)}
            aria-describedby={showErrors && errors.operatorName ? errorId("operator") : undefined}
            onChange={(event) => patch({ operatorName: event.target.value })}
          />
          {showErrors && errors.operatorName ? (
            <p className={styles.error} id={errorId("operator")}>
              {errors.operatorName}
            </p>
          ) : null}
        </div>

        <div className={`${styles.field} ${styles.fieldWide}`}>
          <label htmlFor={field("notes")}>Observação (opcional)</label>
          <textarea
            id={field("notes")}
            rows={2}
            value={position.notes}
            disabled={readOnly}
            placeholder="Divergência, local do material, condição da operação"
            onChange={(event) => patch({ notes: event.target.value })}
          />
        </div>
      </div>

      {showErrors && errors.duplicate ? <p className={styles.error}>{errors.duplicate}</p> : null}

      {locked && !readOnly ? (
        <p className={styles.lockNote}>
          <Icon name="info" size={16} />
          Operação e situação identificam o registro oficial e não mudam depois de salvas. Para corrigir,
          registre uma nova posição.
        </p>
      ) : null}

      <div className={styles.positionActions}>
        <button
          type="button"
          className={styles.savePosition}
          onClick={() => onSave(position.key)}
          disabled={readOnly || saving || (!position.dirty && position.savedKey !== null)}
        >
          <Icon name="save" size={18} />
          {position.savedKey === null ? "Salvar posição" : "Salvar alterações"}
        </button>
        {position.savedKey === null ? (
          <button type="button" className={styles.discardPosition} onClick={() => onDiscard(position.key)} disabled={readOnly}>
            <Icon name="trash" size={18} />
            Descartar
          </button>
        ) : null}
        {position.savedAt && !position.dirty ? (
          <span className={styles.savedAt}>Registrado em {formatDateTimeBR(position.savedAt)}</span>
        ) : null}
      </div>
    </li>
  );
}
