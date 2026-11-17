import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { CatalogProduct, InventoryPayload } from "../../api/types";
import {
  emptyPosition,
  hasErrors,
  positionFromRow,
  productProgress,
  toSavePayload,
  validatePosition,
  type InventoryPosition,
} from "../../lib/inventory";
import AsyncState from "../ui/AsyncState";
import Icon from "../ui/Icon";
import StatusBadge from "../ui/StatusBadge";
import InventoryRow from "./InventoryRow";
import InventorySummary from "./InventorySummary";
import styles from "./Inventory.module.css";

interface OpeningInventoryProps {
  products: CatalogProduct[];
  inventory: InventoryPayload | null;
  loading: boolean;
  error: string;
  onReload: () => void;
  onUnsavedChange: (count: number) => void;
}

export default function OpeningInventory({
  products,
  inventory,
  loading,
  error,
  onReload,
  onUnsavedChange,
}: OpeningInventoryProps) {
  const [positions, setPositions] = useState<InventoryPosition[]>([]);
  const [showErrors, setShowErrors] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const productRefs = useRef(new Map<string, HTMLElement | null>());
  const locked = inventory?.locked === true;

  // Posições salvas vêm da API; rascunhos não salvos do operador são preservados.
  useEffect(() => {
    if (!inventory) return;
    setPositions((current) => {
      const drafts = current.filter((position) => position.dirty || position.savedKey === null);
      const saved = inventory.rows.map(positionFromRow);
      const draftKeys = new Set(drafts.map((position) => position.key));
      return [...saved.filter((position) => !draftKeys.has(position.key)), ...drafts];
    });
  }, [inventory]);

  const unsaved = useMemo(
    () => positions.filter((position) => position.dirty || position.savedKey === null),
    [positions],
  );

  useEffect(() => {
    onUnsavedChange(unsaved.length);
  }, [unsaved.length, onUnsavedChange]);

  useEffect(() => {
    if (!unsaved.length) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved.length]);

  const updatePosition = useCallback((key: string, patch: Partial<InventoryPosition>) => {
    setPositions((current) =>
      current.map((position) => (position.key === key ? { ...position, ...patch } : position)),
    );
  }, []);

  const discardPosition = useCallback((key: string) => {
    setPositions((current) => current.filter((position) => position.key !== key));
  }, []);

  const addPosition = useCallback((product: CatalogProduct) => {
    const firstStage = product.tracking_stages[0]?.process ?? "";
    setPositions((current) => [...current, emptyPosition(product, firstStage)]);
  }, []);

  const savePosition = useCallback(
    async (key: string) => {
      const position = positions.find((item) => item.key === key);
      if (!position) return;
      const siblings = positions.filter((item) => item.productId === position.productId);
      const errors = validatePosition(position, siblings);
      if (hasErrors(errors)) {
        setShowErrors((current) => ({ ...current, [key]: true }));
        setFeedback({
          tone: "danger",
          message: `Corrija os campos destacados de ${position.productName} antes de salvar.`,
        });
        return;
      }

      setSavingKey(key);
      setFeedback(null);
      try {
        const result = await api.saveInventory(position.productId, toSavePayload(position));
        const savedKey = `${position.process.trim()}::${position.positionStatus}`;
        setPositions((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  process: position.process.trim(),
                  operatorName: position.operatorName.trim(),
                  notes: position.notes.trim(),
                  savedKey,
                  savedAt: result.updated_at,
                  dirty: false,
                }
              : item,
          ),
        );
        setShowErrors((current) => ({ ...current, [key]: false }));
        setFeedback({
          tone: "success",
          message: `Posição de ${position.productName} em ${position.process} salva no controle.`,
        });
      } catch (cause) {
        setFeedback({
          tone: "danger",
          message:
            cause instanceof ApiError
              ? `Não foi possível salvar ${position.productName}: ${cause.message}`
              : `Não foi possível salvar ${position.productName}.`,
        });
      } finally {
        setSavingKey(null);
      }
    },
    [positions],
  );

  const focusProduct = useCallback((productId: string) => {
    setOnlyPending(false);
    window.requestAnimationFrame(() => {
      const node = productRefs.current.get(productId);
      node?.scrollIntoView({ block: "center" });
      node?.querySelector<HTMLElement>("button, select, input")?.focus();
    });
  }, []);

  if (loading && !inventory) {
    return (
      <AsyncState
        state="loading"
        title="Consultando o inventário de abertura"
        message="Buscando as posições já registradas no banco do controle."
        skeleton="rows"
      />
    );
  }

  if (error && !inventory) {
    return (
      <AsyncState
        state="error"
        title="Inventário de abertura indisponível"
        message={`${error} Nenhum valor foi presumido.`}
        onRetry={onReload}
      />
    );
  }

  const visibleProducts = onlyPending
    ? products.filter((product) => !productProgress(product.id, positions).recorded)
    : products;

  return (
    <div className={styles.page}>
      <InventorySummary
        products={products}
        positions={positions}
        referenceLabel={inventory?.reference_date_label ?? "não informada"}
        unsavedCount={unsaved.length}
        onlyPending={onlyPending}
        onTogglePending={setOnlyPending}
        onFocusProduct={focusProduct}
      />

      <p
        className={[
          styles.feedback,
          feedback?.tone === "danger" ? styles.feedbackDanger : "",
          feedback ? "" : styles.feedbackIdle,
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
      >
        {locked ? (
          <>
            <Icon name="info" size={18} />
            {inventory?.lock_message || "Inventário temporariamente bloqueado para alterações."}
          </>
        ) : feedback ? (
          <>
            <Icon name={feedback.tone === "danger" ? "critical" : "check"} size={18} />
            {feedback.message}
          </>
        ) : (
          "As posições são salvas individualmente. Nenhum valor é gravado sem confirmação."
        )}
      </p>

      {visibleProducts.length ? (
        <ul className={styles.productList}>
          {visibleProducts.map((product) => {
            const own = positions.filter((position) => position.productId === product.id);
            const progress = productProgress(product.id, positions);
            return (
              <li
                key={product.id}
                className={styles.product}
                ref={(node) => {
                  productRefs.current.set(product.id, node);
                }}
              >
                <header className={styles.productHead}>
                  <div className={styles.productIdentity}>
                    <strong>{product.name}</strong>
                    <span className={`${styles.productCode} fc-mono`}>CÓDIGO: {product.code}</span>
                  </div>
                  <div className={styles.productState}>
                    {progress.recorded ? (
                      <StatusBadge tone="success">
                        {progress.savedPositions} posição(ões) salva(s)
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Aguardando registro</StatusBadge>
                    )}
                    <button type="button" className={styles.addPosition} onClick={() => addPosition(product)} disabled={locked}>
                      <Icon name="plus" size={18} />
                      Adicionar posição
                    </button>
                  </div>
                </header>

                {own.length ? (
                  <ul className={styles.positions}>
                    {own.map((position) => (
                      <InventoryRow
                        key={position.key}
                        product={product}
                        position={position}
                        errors={validatePosition(position, own)}
                        showErrors={showErrors[position.key] === true}
                        saving={savingKey === position.key}
                        readOnly={locked}
                        onChange={updatePosition}
                        onSave={savePosition}
                        onDiscard={discardPosition}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className={styles.productEmpty}>
                    Nenhuma posição registrada. O valor permanece <strong>Não informado</strong> até a
                    contagem ser lançada.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <AsyncState
          state="empty"
          compact
          title="Nenhum produto pendente"
          message="Todos os produtos já têm posição registrada para a data de referência."
        />
      )}
    </div>
  );
}
