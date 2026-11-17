import type { DivergenceItem, DivergencesPayload } from "../../api/types";
import { formatDateTimeBR, formatKgBR, formatPieces } from "../../lib/formatters";
import AsyncState from "../ui/AsyncState";
import Icon from "../ui/Icon";
import styles from "./DivergencesPanel.module.css";

interface DivergencesPanelProps {
  divergences: DivergencesPayload | null;
  loading: boolean;
  error: string;
  onReload: () => void;
  onOpenProduct: (productId: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  saldo_negativo: "Saldo negativo",
  saldo_inconsistente: "Saldo inconsistente",
  pecas_sem_lote: "Peças sem lote",
  fonte_indisponivel: "Fonte indisponível",
};

function formatQuantity(item: DivergenceItem): string {
  if (item.quantity === null) return "";
  return item.unit === "kg" ? formatKgBR(item.quantity) : `${formatPieces(item.quantity)} peças`;
}

function DivergenceCard({
  item,
  onOpenProduct,
}: {
  item: DivergenceItem;
  onOpenProduct: (productId: string) => void;
}) {
  return (
    <article className={`${styles.card} ${styles[`card_${item.severity}`]}`}>
      <header className={styles.cardHead}>
        <Icon name={item.severity === "critical" ? "critical" : "alert"} size={20} />
        <div className={styles.cardHeadText}>
          <span className={styles.cardKind}>{KIND_LABEL[item.kind] ?? item.kind}</span>
          <button type="button" className={styles.cardProduct} onClick={() => onOpenProduct(item.product_id)}>
            {item.product_name}
          </button>
        </div>
        {item.quantity !== null ? (
          <strong className={`${styles.cardQuantity} fc-mono`}>{formatQuantity(item)}</strong>
        ) : null}
      </header>

      <p className={styles.cardReason}>
        {item.reference ? <span className={styles.cardReference}>{item.reference}</span> : null}
        {item.reason}
      </p>

      {/*
        O apurado vem antes da hipótese. "Em 04/09 a Solda apontou 2.135 e a
        Usinagem apontou 0" resolve; "apontamento pode ter sido lançado fora
        de ordem" só descreve o gênero do problema.
      */}
      {item.diagnosis?.length ? (
        <div className={styles.diagnosis}>
          <span className="fc-label">O que foi apurado</span>
          <ul>
            {item.diagnosis.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.possible_causes.length ? (
        <details className={styles.causes}>
          <summary className="fc-label">
            {item.diagnosis?.length ? "Outros motivos possíveis" : "Motivos possíveis"}
          </summary>
          <ul>
            {item.possible_causes.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/**
 * Divergências reais: saldo negativo, saldo que não bate com a soma dos
 * lotes, e peças que a rastreabilidade não conseguiu conciliar com nenhum
 * lote de vergalhão -- sempre com motivos possíveis, nunca só o número.
 */
export default function DivergencesPanel({
  divergences,
  loading,
  error,
  onReload,
  onOpenProduct,
}: DivergencesPanelProps) {
  if (loading && !divergences) {
    return (
      <AsyncState
        state="loading"
        title="Varrendo as 13 peças"
        message="Consultando TOTVS e apontamentos de cada peça para achar saldo negativo ou peças sem conciliação. A varredura fala com o TOTVS peça a peça e costuma passar de um minuto."
        skeleton="cards"
      />
    );
  }

  if (error && !divergences) {
    return (
      <AsyncState
        state="error"
        title="Não foi possível varrer as divergências"
        message={`${error} Nenhuma divergência foi presumida.`}
        onRetry={onReload}
      />
    );
  }

  const items = divergences?.items ?? [];
  const acao = items.filter((item) => item.classe !== "origem");
  const origem = items.filter((item) => item.classe === "origem");
  const critical = acao.filter((item) => item.severity === "critical");
  const attention = acao.filter((item) => item.severity === "attention");
  const originPieces = divergences?.origin_pieces ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <span className="fc-label">Divergências</span>
          <h2>Saldo negativo e peças sem conciliação</h2>
          <p className={styles.headNote}>
            Cada peça é conferida contra o próprio motor de rastreabilidade (TOTVS + apontamentos).
            Os contadores somam só o que pede ação — a condição de origem fica na lista de baixo.
            {divergences?.generated_at ? ` Última varredura: ${formatDateTimeBR(divergences.generated_at)}.` : ""}
          </p>
        </div>
        <button type="button" className={styles.reload} onClick={onReload} disabled={loading}>
          <Icon name="refresh" size={18} />
          {loading ? "Consultando…" : "Atualizar"}
        </button>
      </header>

      <dl className={styles.counters}>
        <div className={styles.counterCritical}>
          <dt>Críticas</dt>
          <dd className="fc-mono">{divergences?.critical_count ?? 0}</dd>
        </div>
        <div className={styles.counterAttention}>
          <dt>Atenção</dt>
          <dd className="fc-mono">{divergences?.attention_count ?? 0}</dd>
        </div>
      </dl>

      {acao.length ? (
        <div className={styles.groups}>
          {critical.length ? (
            <section aria-labelledby="divergences-critical">
              <h3 id="divergences-critical" className={styles.groupTitle}>
                Críticas
              </h3>
              <div className={styles.grid}>
                {critical.map((item, index) => (
                  <DivergenceCard key={`${item.product_id}-${item.kind}-${index}`} item={item} onOpenProduct={onOpenProduct} />
                ))}
              </div>
            </section>
          ) : null}
          {attention.length ? (
            <section aria-labelledby="divergences-attention">
              <h3 id="divergences-attention" className={styles.groupTitle}>
                Atenção
              </h3>
              <div className={styles.grid}>
                {attention.map((item, index) => (
                  <DivergenceCard key={`${item.product_id}-${item.kind}-${index}`} item={item} onOpenProduct={onOpenProduct} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <AsyncState
          state="empty"
          compact
          title="Nada pedindo ação"
          message="Nenhum saldo negativo e nenhuma peça sem conciliação que dependa de alguém, agora."
        />
      )}

      {origem.length ? (
        <details className={styles.origin}>
          <summary className={styles.originSummary}>
            <span className={styles.originTitle}>Sem lote por origem</span>
            <span className={`${styles.originCount} fc-mono`}>{origem.length}</span>
            {originPieces > 0 ? (
              <span className={styles.originPieces}>{formatPieces(originPieces)} peças</span>
            ) : null}
          </summary>
          <p className={styles.originNote}>
            Peça produzida antes de existir transferência de vergalhão no TOTVS — não há lote a
            atribuir. Some quando a transferência da peça for lançada com o número de série.
          </p>
          <div className={styles.grid}>
            {origem.map((item, index) => (
              <DivergenceCard key={`${item.product_id}-${item.kind}-${index}`} item={item} onOpenProduct={onOpenProduct} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
