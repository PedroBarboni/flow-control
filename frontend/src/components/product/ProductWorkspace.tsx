import { useCallback, useMemo, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { Period } from "../../api/client";
import type {
  OverviewProduct,
  TotvsPayload,
  TraceabilityPayload,
} from "../../api/types";
import { formatPieces } from "../../lib/formatters";
import { materialAuditRows } from "../../lib/operationMaterial";
import { buildProductionFlow, type FlowStage } from "../../lib/productionFlow";
import ProductionRoute from "../route/ProductionRoute";
import MovementHistory from "./MovementHistory";
import AuditModal, { type AuditDetail } from "../ui/AuditModal";
import Icon from "../ui/Icon";
import LotPositionRail from "./LotPositionRail";
import MaterialBalanceBoard from "./MaterialBalanceBoard";
import MaterialTraceRail from "./MaterialTraceRail";
import ProductContext from "./ProductContext";
import styles from "./ProductWorkspace.module.css";

interface ProductWorkspaceProps {
  product: OverviewProduct;
  period: string;
  periodRange: Period;
  onPeriodChange: (period: string) => void;
  totvs: TotvsPayload | null;
  totvsLoading: boolean;
  totvsError: string;
  traceability: TraceabilityPayload | null;
  traceabilityError: string;
  onBack: () => void;
  onOpenLots: () => void;
}

const stageTopic = (stage: FlowStage): string =>
  `stage-${String(stage.name || stage.tracking_name || "")
    .toLowerCase()
    .replace(/\s+/g, "-")}`;

export default function ProductWorkspace({
  product,
  period,
  periodRange,
  onPeriodChange,
  totvs,
  totvsLoading,
  totvsError,
  traceability,
  traceabilityError,
  onBack,
  onOpenLots,
}: ProductWorkspaceProps) {
  const [audit, setAudit] = useState<AuditDetail | null>(null);

  const flow = useMemo(
    () => buildProductionFlow(product.stages, traceability),
    [product.stages, traceability],
  );

  const alerts = useMemo(() => {
    const list: { tone: "critical" | "attention"; message: string }[] = [];
    // O bloqueio só está de fato suspendendo consumo se a data já chegou.
    // `material_consumption_locked` apenas diz que existe uma data configurada
    // — sempre existe —, então sozinho ele avisaria de um bloqueio inexistente.
    const lockedFrom = traceability?.controls?.material_consumption_locked_from;
    const lockActive = Boolean(lockedFrom) && new Date(lockedFrom as string) <= new Date();
    if (lockActive) {
      list.push({
        tone: "attention",
        message: "Consumo de vergalhão temporariamente suspenso. Novos apontamentos não reduzem o saldo dos lotes.",
      });
    }
    for (const stage of product.stages) {
      if (stage.status === "critical") {
        list.push({
          tone: "critical",
          message: `${stage.tracking_name || stage.name}: perda apontada em nível crítico (${formatPieces(
            stage.loss,
          )} peças).`,
        });
      } else if (stage.status === "attention") {
        list.push({
          tone: "attention",
          message: `${stage.tracking_name || stage.name}: perda acima do esperado (${formatPieces(
            stage.loss,
          )} peças).`,
        });
      }
      const trackedStage = flow.stages.find(
        (candidate) => (candidate.tracking_name || candidate.name) === (stage.tracking_name || stage.name),
      );
      const unresolvedPieces = traceability
        ? trackedStage?.flow_divergence ?? 0
        : stage.unidentified_waiting_pieces ?? 0;
      if (unresolvedPieces > 0) {
        list.push({
          tone: "attention",
          message: `${stage.tracking_name || stage.name}: ${formatPieces(
            unresolvedPieces,
          )} peças aguardando sem lote identificado.`,
        });
      }
    }
    if (product.rod_available === false) {
      list.push({ tone: "attention", message: "Vergalhão desta peça não está disponível no catálogo TOTVS." });
    }
    return list;
  }, [flow.stages, product, traceability]);

  const openTopicAudit = useCallback(
    async (topic: string) => {
      setAudit({ title: "Consultando", source: "API do controle", rows: [], state: "loading" });
      try {
        const detail = await api.detail(topic, product.id, periodRange);
        const trace = materialAuditRows(totvs ?? {}, product);
        setAudit({
          title: detail.title,
          source: detail.source,
          rows: [...detail.rows.slice(0, 1), ...trace, ...detail.rows.slice(1)],
        });
      } catch (cause) {
        setAudit({
          title: "Detalhes indisponíveis",
          source: "A consulta não respondeu",
          rows: [
            [
              "Situação",
              cause instanceof ApiError ? cause.message : "Nenhum valor foi presumido. Tente novamente.",
            ],
          ],
        });
      }
    },
    [product, periodRange, totvs],
  );

  const openStageAudit = useCallback(
    async (stage: FlowStage) => {
      const processName = stage.tracking_name || stage.name;
      setAudit({ title: processName, source: "Rastreabilidade por lote", rows: [], state: "loading" });
      const normalized = String(processName)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      try {
        const [detail, stagePosition] = await Promise.all([
          api.detail(stageTopic(stage), product.id, periodRange).catch(() => null),
          Promise.resolve(
            traceability?.stages.find((row) => row.process === normalized) ?? null,
          ),
        ]);

        const rows: [string, string][] = [];
        if (detail) rows.push(...detail.rows);

        if (stagePosition) {
          rows.push(["Saldo aguardando esta etapa", `${formatPieces(stagePosition.available_pieces)} peças`]);
          rows.push(["Com lote identificado", `${formatPieces(stagePosition.identified_pieces)} peças`]);
          rows.push(["Lote de abertura", `${formatPieces(stagePosition.opening_pieces)} peças`]);
          rows.push([
            "Aguardando conciliação",
            `${formatPieces(stagePosition.unmatched_pieces)} peças · calculado`,
          ]);
          for (const lot of stagePosition.lots) {
            rows.push([
              `Lote ${lot.lot_id}`,
              `${formatPieces(lot.pieces)} peças · ${
                lot.origin_type === "material" ? "lote novo" : "lote de abertura"
              }`,
            ]);
            rows.push([
              "Lote oficial do vergalhão",
              lot.material_lot_id || "Não se aplica ao lote de abertura",
            ]);
          }
        } else {
          rows.push(["Rastreabilidade por lote", "Dado indisponível para esta operação."]);
        }

        setAudit({
          title: processName,
          source: detail?.source || "Rastreabilidade FIFO por lote · Apontamentos",
          rows,
        });
      } catch (cause) {
        setAudit({
          title: processName,
          source: "A consulta não respondeu",
          rows: [
            [
              "Situação",
              cause instanceof ApiError ? cause.message : "Nenhum lote ou saldo foi presumido.",
            ],
          ],
        });
      }
    },
    [product.id, periodRange, traceability],
  );

  return (
    <div className={styles.workspace}>
      <ProductContext
        product={product}
        period={period}
        onPeriodChange={onPeriodChange}
        materialLotId={flow.material.active_lot_id}
        remainingRodKg={flow.material.active_lot_balance_kg}
        onBack={onBack}
        onOpenLots={onOpenLots}
      />

      <section className={styles.alerts} aria-label="Alertas e divergências">
        {alerts.length ? (
          <ul>
            {alerts.map((alert) => (
              <li
                key={alert.message}
                className={alert.tone === "critical" ? styles.alertCritical : styles.alertAttention}
              >
                <Icon name={alert.tone === "critical" ? "critical" : "alert"} size={18} />
                {alert.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.alertNormal}>
            <Icon name="check" size={18} />
            Nenhuma divergência ou perda acima do limite no período selecionado.
          </p>
        )}
      </section>

      <LotPositionRail product={product} flow={flow} />

      <ProductionRoute
        product={product}
        flow={flow}
        traceabilityError={traceabilityError}
        onAudit={openStageAudit}
        onMaterialAudit={() => openTopicAudit("estimate")}
      />

      <MaterialBalanceBoard
        product={product}
        totvs={totvs}
        totvsLoading={totvsLoading}
        totvsError={totvsError}
        flow={flow}
        onAudit={openTopicAudit}
      />

      <MaterialTraceRail
        totvs={totvs}
        totvsLoading={totvsLoading}
        materialLotId={flow.material.active_lot_id}
        traceability={traceability}
        onAudit={openTopicAudit}
      />

      <MovementHistory productId={product.id} productName={product.name} />

      {audit ? <AuditModal detail={audit} onClose={() => setAudit(null)} /> : null}
    </div>
  );
}
