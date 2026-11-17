import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { MovementItem, MovementsPayload } from "../../api/types";
import { formatDateTimeBR, formatKgBR, formatPieces, MISSING_VALUE } from "../../lib/formatters";
import AsyncState from "../ui/AsyncState";
import Icon from "../ui/Icon";
import styles from "./MovementHistory.module.css";

interface MovementHistoryProps {
  productId: string;
  productName: string;
}

const TYPE_LABEL: Record<string, string> = {
  consumo_vergalhao: "Consumo de vergalhão",
  etapa: "Passagem de etapa",
  sem_conciliacao: "Sem conciliação",
};

function MovementRow({ item }: { item: MovementItem }) {
  const isScrapless = item.movement_type === "sem_conciliacao";
  return (
    <tr className={isScrapless ? styles.rowUnmatched : undefined}>
      <td className={`${styles.cellDate} fc-mono`}>
        {item.occurred_at ? formatDateTimeBR(item.occurred_at).slice(0, 10) : MISSING_VALUE}
      </td>
      <td>
        <span className={styles.type}>{TYPE_LABEL[item.movement_type] ?? item.movement_type}</span>
        <span className={styles.process}>{item.process}</span>
        {item.next_process ? <span className={styles.next}>→ {item.next_process}</span> : null}
      </td>
      <td className={`${styles.cellLot} fc-mono`}>{item.material_lot_id || MISSING_VALUE}</td>
      <td className={`${styles.cellNumber} fc-mono`}>{formatPieces(item.good_pieces)}</td>
      <td className={`${styles.cellNumber} fc-mono`}>{formatPieces(item.loss_pieces)}</td>
      <td className={`${styles.cellNumber} fc-mono`}>
        {item.consumed_kg > 0 ? formatKgBR(item.consumed_kg) : MISSING_VALUE}
      </td>
      <td className={styles.cellNote}>{item.reason || item.machine || MISSING_VALUE}</td>
    </tr>
  );
}

/**
 * Histórico imutável das movimentações da peça.
 *
 * Fica recolhido e só busca quando aberto: a consulta reconstrói a
 * rastreabilidade no servidor e leva segundos — não pode pesar na abertura
 * da peça, que é o que o operador faz o dia inteiro.
 */
export default function MovementHistory({ productId, productName }: MovementHistoryProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MovementsPayload | null>(null);
  const [items, setItems] = useState<MovementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  // Trocar de peça invalida o que estava carregado: histórico é por peça.
  useEffect(() => {
    setData(null);
    setItems([]);
    setError("");
    setOpen(false);
  }, [productId]);

  useEffect(() => () => abort.current?.abort(), []);

  const load = useCallback(
    async (beforeId: number | null) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      setError("");
      try {
        const payload = await api.movements(productId, beforeId, controller.signal);
        setData(payload);
        setItems((current) => (beforeId ? [...current, ...payload.items] : payload.items));
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") return;
        setError((cause as Error)?.message || "Histórico não respondeu.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [productId],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data) void load(null);
  };

  return (
    <section className={styles.panel} aria-labelledby="movement-history-title">
      <button type="button" className={styles.head} onClick={toggle} aria-expanded={open}>
        <Icon name={open ? "chevronDown" : "arrowRight"} size={18} />
        <span className={styles.headText}>
          <span className="fc-label">Histórico</span>
          <h3 id="movement-history-title">Movimentações registradas</h3>
        </span>
        {data ? (
          <span className={`${styles.headCount} fc-mono`}>{formatPieces(data.summary.total)}</span>
        ) : null}
      </button>

      {open ? (
        <div className={styles.body}>
          <p className={styles.note}>
            Cada linha é uma decisão do motor de rastreabilidade de {productName}, gravada uma vez e
            nunca alterada — correção entra como linha nova, então esta lista é a prova do que o
            sistema fez.
            {data?.summary.last_recorded_at
              ? ` Último registro: ${formatDateTimeBR(data.summary.last_recorded_at)}.`
              : ""}
          </p>

          {data?.stale_reason ? (
            <p className={styles.stale} role="status">
              <Icon name="alert" size={16} />
              {data.stale_reason}
            </p>
          ) : null}

          {loading && !items.length ? (
            <AsyncState
              state="loading"
              compact
              title="Consultando o histórico"
              message="Reconstruindo a rastreabilidade para arquivar o que ainda faltava."
              skeleton="rows"
            />
          ) : error && !items.length ? (
            <AsyncState
              state="error"
              compact
              title="Histórico indisponível"
              message={`${error} Nada foi presumido.`}
              onRetry={() => void load(null)}
            />
          ) : items.length ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Movimento</th>
                      <th scope="col">Lote</th>
                      <th scope="col">Boas</th>
                      <th scope="col">Perda</th>
                      <th scope="col">Vergalhão</th>
                      <th scope="col">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <MovementRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>

              {data?.next_before_id ? (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => void load(data.next_before_id)}
                  disabled={loading}
                >
                  {loading ? "Carregando…" : "Carregar mais"}
                </button>
              ) : (
                <p className={styles.end}>Fim do histórico registrado.</p>
              )}
            </>
          ) : (
            <AsyncState
              state="empty"
              compact
              title="Nenhuma movimentação registrada"
              message="Esta peça ainda não teve apontamento conciliado no período controlado."
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
