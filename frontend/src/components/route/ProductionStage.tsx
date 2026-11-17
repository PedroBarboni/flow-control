import { formatDateBR, formatKgBR, formatPieces, MISSING_LABEL } from "../../lib/formatters";
import type { RouteOutput } from "../../api/types";
import type { FlowStage } from "../../lib/productionFlow";
import Icon from "../ui/Icon";
import styles from "./ProductionRoute.module.css";

interface ProductionStageProps {
  stage: FlowStage;
  index: number;
  /** Para onde vai a pilha parada nesta etapa; `null` na última operação. */
  nextStageName: string | null;
  /** O que a rota entrega no fim — peça pré-acabada ou componente. */
  routeOutput: RouteOutput;
  onAudit: (stage: FlowStage) => void;
}

const STATUS_LABEL: Record<string, string> = {
  normal: "Normal",
  attention: "Atenção",
  critical: "Crítico",
  blocked: "Bloqueado",
  empty: "Sem dados",
};

const STATUS_ICON: Record<string, "check" | "alert" | "critical" | "info"> = {
  normal: "check",
  attention: "alert",
  critical: "critical",
  empty: "info",
};

/** Uma operação da rota: identificação, produção, perda, sucata e fila. */
export default function ProductionStage({ stage, index, nextStageName, routeOutput, onAudit }: ProductionStageProps) {
  const status = String(stage.status || "empty");
  const name = stage.tracking_name || stage.name;
  const unidentified = stage.unidentified_waiting_pieces ?? 0;
  // Composição da PILHA mostrada aqui — que é a fila da etapa seguinte, não
  // a desta etapa. Ler `opening_pieces`/`identified_pieces` faria a nota
  // descrever um monte diferente do número exibido logo acima dela.
  const opening = stage.queue_opening_pieces ?? 0;
  const identified = stage.queue_identified_pieces ?? 0;
  const awaitingTotal = stage.awaiting_pieces_total;
  const queued = Number(stage.awaiting_pieces) || 0;

  const productionNote = stage.last_date
    ? `Apontado em ${formatDateBR(stage.last_date)}`
    : opening > 0
      ? "Sem novos apontamentos após o inventário"
      : "Sem apontamentos no período";

  /*
    O cartão mostra a pilha que ESTA etapa deixou pronta e a seguinte ainda
    não puxou — ela está fisicamente na saída daqui, e é aqui que o operador
    procura por ela.

    "etapa <nome>" em vez de "a Forja"/"o Corte" evita errar o artigo, que
    muda de etapa para etapa.
  */
  const queueNote = opening > 0 && identified > 0
    ? `${formatPieces(opening)} do inventário de abertura · ${formatPieces(identified)} com lote oficial`
    : opening > 0
      ? `${formatPieces(opening)} do inventário de abertura`
      : identified > 0
        ? `${formatPieces(identified)} com lote oficial`
        : "posição controlada";

  // Peça sem conciliação NÃO está na fila: ela foi apontada aqui e seguiu
  // adiante sem origem rastreável. Some no total do chão de fábrica, mas
  // precisa ser nomeada pelo que é.
  const unmatchedNote = `${formatPieces(unidentified)} apontadas nesta etapa sem origem rastreada`;

  // A última operação da rota entrega peça pronta: não existe fila depois
  // dela, e o que foi apontado ali já está em "produzidas no período".
  // Mostrar isso como parado contaria a mesma peça duas vezes.
  //
  // Qual operação é essa muda por família — Laminação nos conectors e no
  // Pino guia, Usinagem no Bucha at, Solda nos Placas e Suportes — por
  // isso o texto nomeia a etapa em vez de assumir uma. E a Eixo não vira
  // pré-acabada: ela é componente da Solda do Placa.
  const isFinalStep = !nextStageName;
  const finalNote = routeOutput === "componente"
    ? `Componente pronto ao fim da etapa ${name} — não vira pré-acabado, segue para a Solda`
    : `Peça pré-acabada ao fim da etapa ${name} — não fica em fila`;
  const waitingFor = nextStageName || "próxima etapa";
  const awaitingNote = isFinalStep
    ? unidentified > 0
      ? `${finalNote} · ${formatPieces(unidentified)} apontadas sem origem rastreada, tratadas em Divergências`
      : finalNote
    : queued > 0 && unidentified > 0
      ? `${formatPieces(queued)} aguardando a etapa ${waitingFor} (${queueNote}) · ${unmatchedNote}`
      : unidentified > 0
        ? unmatchedNote
        : queued > 0
          ? `Aguardando a etapa ${waitingFor} · ${queueNote}`
          : "Nenhuma peça aguardando";

  return (
    <li className={`${styles.stage} ${styles[`stage_${status}`] ?? ""}`}>
      <div className={styles.stageIndex} aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>

      <div className={styles.stageIdentity}>
        <span className={`${styles.stageCode} fc-mono`}>{stage.totvs_code || MISSING_LABEL}</span>
        <h3 className={styles.stageName}>{name}</h3>
        <span className={styles.stageMachine}>{stage.machine || "Equipamento não informado"}</span>
        <span className={`${styles.stageStatus} ${styles[`status_${status}`] ?? ""}`}>
          <Icon name={STATUS_ICON[status] ?? "info"} size={16} />
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/*
        O que está parado nesta etapa AGORA é a pergunta que o chão de fábrica
        faz na frente do quadro. Ficava perdido como o quinto número de uma
        grade em que todos os outros são acumulado do período — e "peças
        produzidas" era lido como estoque. Sai da grade e vira o número
        grande da etapa; o histórico continua ao lado, menor.
      */}
      <div
        className={`${styles.stageFloor} ${
          Number(awaitingTotal) <= 0
            ? styles.stageFloorEmpty
            : unidentified > 0
              ? styles.stageFloorAttention
              : styles.stageFloorActive
        }`}
      >
        <span className={styles.stageFloorLabel}>No chão de fábrica</span>
        <strong className={`${styles.stageFloorValue} fc-mono`}>{formatPieces(awaitingTotal)}</strong>
        <span className={styles.stageFloorNote}>{awaitingNote}</span>
      </div>

      <dl className={styles.stageStats}>
        <div>
          <dt>Produzidas no período</dt>
          <dd className="fc-mono">{formatPieces(stage.reported)}</dd>
          <small>{productionNote}</small>
        </div>
        <div>
          <dt>Perdas apontadas</dt>
          <dd className="fc-mono">{formatPieces(stage.loss)}</dd>
          <small>{formatKgBR(stage.rejection_scrap_kg)} por rejeição</small>
        </div>
        <div>
          <dt>Sucata calculada</dt>
          <dd className="fc-mono">{formatKgBR(stage.total_scrap_kg)}</dd>
          <small>Rejeição mais redução de peso</small>
        </div>
        <div>
          <dt>Peso unitário</dt>
          <dd className="fc-mono">{formatKgBR(stage.unit_weight_kg)}</dd>
          <small>Declarado para a etapa</small>
        </div>
      </dl>

      <button type="button" className={styles.stageAudit} onClick={() => onAudit(stage)}>
        Abrir detalhes
        <Icon name="arrowRight" size={16} />
      </button>
    </li>
  );
}
