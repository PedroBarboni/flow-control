import { useState } from "react";
import type { CatalogProduct, MaterialLotItem, MaterialLotsPayload, MaterialLotStatus } from "../../api/types";
import { formatKgBR, formatPieces, MISSING_LABEL } from "../../lib/formatters";
import { estimateMaterialOutcome, producedScrapKg } from "../../lib/materialBalance";
import AsyncState from "../ui/AsyncState";
import AuditModal, { type AuditDetail } from "../ui/AuditModal";
import Icon from "../ui/Icon";
import styles from "./MaterialLots.module.css";

interface MaterialLotBoardProps {
  materialLots: MaterialLotsPayload | null;
  loading: boolean;
  error: string;
  onReload: () => void;
  products: CatalogProduct[];
  onOpenProduct: (productId: string) => void;
}

const STATUS_LABEL: Record<MaterialLotStatus, string> = {
  fechado: "Fechado",
  em_processo: "Em processo",
  consumido: "Consumido",
};

const STATUS_ORDER: MaterialLotStatus[] = ["em_processo", "fechado", "consumido"];

function buildDetail(item: MaterialLotItem, product: CatalogProduct | undefined): AuditDetail {
  const stages = product?.tracking_stages ?? null;
  const estimate = estimateMaterialOutcome(item.initial_kg, item.blank_weight_kg, stages);
  const scrapProduced = producedScrapKg(item.produced_pieces, item.loss_pieces, item.blank_weight_kg, stages);

  const rows: [string, string][] = [
    ["Peças estimadas", estimate ? `${formatPieces(estimate.pieces)} peças · calculado pelo peso do blank` : MISSING_LABEL],
    ["Peças produzidas", `${formatPieces(item.produced_pieces)} peças · chegaram prontas ao fim da rota`],
    ["Perda", `${formatPieces(item.loss_pieces)} peças · em qualquer etapa da rota`],
    ["Sucata estimada", estimate ? `${formatKgBR(estimate.scrapKg)} · calculado, capacidade total do lote` : MISSING_LABEL],
    ["Sucata produzida", scrapProduced === null ? MISSING_LABEL : `${formatKgBR(scrapProduced)} · calculado, do que já foi produzido`],
    ["Kg recebido", formatKgBR(item.initial_kg)],
    ["Kg restante", formatKgBR(item.balance_kg)],
    ["Kg consumido", formatKgBR(item.consumed_kg)],
  ];
  if (item.document) rows.push(["Documento TOTVS", item.document]);
  // item.date já vem formatado DD/MM/AAAA pelo backend (backend/totvs.py:_date).
  if (item.date) rows.push(["Data da transferência", item.date]);

  return {
    title: `Lote ${item.lot_id}`,
    source: "Rastreabilidade por lote · TOTVS + Apontamentos",
    rows,
  };
}

function LotCard({
  item,
  onOpenProduct,
  onOpenDetail,
}: {
  item: MaterialLotItem;
  onOpenProduct: (productId: string) => void;
  onOpenDetail: (item: MaterialLotItem) => void;
}) {
  return (
    <article className={`${styles.card} ${styles[`card_${item.status}`]}`}>
      <header className={styles.cardHead}>
        <span className={`${styles.badge} ${styles[`badge_${item.status}`]}`}>{STATUS_LABEL[item.status]}</span>
        <strong className={`${styles.cardLot} fc-mono`}>{item.lot_id}</strong>
      </header>

      <button type="button" className={styles.cardProduct} onClick={() => onOpenProduct(item.product_id)}>
        {item.product_name}
        <Icon name="arrowRight" size={16} />
      </button>

      <dl className={styles.cardData}>
        <div>
          <dt>Kg recebido</dt>
          <dd className="fc-mono">{formatKgBR(item.initial_kg)}</dd>
        </div>
        <div>
          <dt>Kg restante</dt>
          <dd className="fc-mono">{formatKgBR(item.balance_kg)}</dd>
        </div>
      </dl>

      <button type="button" className={styles.detailButton} onClick={() => onOpenDetail(item)}>
        Abrir detalhes
        <Icon name="arrowRight" size={16} />
      </button>
    </article>
  );
}

/**
 * Lotes de vergalhão das 13 peças — o lote real, criado pela transferência
 * do TOTVS, não um lote de produção manual (que nunca foi usado).
 */
export default function MaterialLotBoard({
  materialLots,
  loading,
  error,
  onReload,
  products,
  onOpenProduct,
}: MaterialLotBoardProps) {
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const productById = new Map(products.map((product) => [product.id, product]));

  if (loading && !materialLots) {
    return (
      <AsyncState
        state="loading"
        title="Consultando os lotes de vergalhão"
        message="Buscando TOTVS e apontamentos das 13 peças. A consulta fala com o TOTVS peça a peça e costuma passar de um minuto."
        skeleton="cards"
      />
    );
  }

  if (error && !materialLots) {
    return (
      <AsyncState
        state="error"
        title="Lotes de vergalhão indisponíveis"
        message={`${error} Nenhum lote foi presumido.`}
        onRetry={onReload}
      />
    );
  }

  const items = materialLots?.items ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <span className="fc-label">Lotes de vergalhão</span>
          <h2>Fechado, em processo ou consumido</h2>
          <p className={styles.headNote}>
            Cada lote vem de uma transferência oficial do TOTVS — não é lote criado manualmente. O
            estado é o consumo real: <strong>fechado</strong> enquanto nada foi tirado dele, mesmo
            sendo o próximo da fila FIFO; <strong>em processo</strong> depois do primeiro corte;{" "}
            <strong>consumido</strong> quando o saldo zera.
          </p>
        </div>
        <button type="button" className={styles.reload} onClick={onReload} disabled={loading}>
          <Icon name="refresh" size={18} />
          {loading ? "Consultando…" : "Atualizar"}
        </button>
      </header>

      <dl className={styles.counters}>
        {STATUS_ORDER.map((status) => (
          <div key={status} className={styles[`counter_${status}`]}>
            <dt>{STATUS_LABEL[status]}</dt>
            <dd className="fc-mono">{materialLots?.counts?.[status] ?? 0}</dd>
          </div>
        ))}
      </dl>

      {items.length ? (
        <div className={styles.groups}>
          {STATUS_ORDER.map((status) => {
            const group = items.filter((item) => item.status === status);
            if (!group.length) return null;
            return (
              <section key={status} aria-labelledby={`material-lots-${status}`}>
                <h3 id={`material-lots-${status}`} className={styles.groupTitle}>
                  {STATUS_LABEL[status]}
                </h3>
                <div className={styles.grid}>
                  {group.map((item) => (
                    <LotCard
                      key={`${item.product_id}-${item.lot_id}`}
                      item={item}
                      onOpenProduct={onOpenProduct}
                      onOpenDetail={(selected) => setDetail(buildDetail(selected, productById.get(selected.product_id)))}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <AsyncState
          state="empty"
          compact
          title="Nenhum lote de vergalhão encontrado"
          message="Nenhuma das 13 peças tem transferência de vergalhão identificada no TOTVS agora."
        />
      )}

      {detail ? <AuditModal detail={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
