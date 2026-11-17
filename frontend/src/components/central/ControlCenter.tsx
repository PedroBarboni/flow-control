import type {
  CatalogProduct,
  DivergencesPayload,
  Integration,
  InventoryPayload,
} from "../../api/types";
import { formatPieces, MISSING_LABEL } from "../../lib/formatters";
import { getIntegrationPresentation } from "../../lib/integrations";
import type { DestinationId } from "../shell/CommandHeader";
import Icon, { type IconName } from "../ui/Icon";
import styles from "./ControlCenter.module.css";

interface ControlCenterProps {
  products: CatalogProduct[];
  productsLoading: boolean;
  integrations: Integration[];
  integrationsUnavailable: boolean;
  inventory: InventoryPayload | null;
  inventoryError: string;
  divergences: DivergencesPayload | null;
  divergencesLoading: boolean;
  divergencesError: string;
  onNavigate: (destination: DestinationId) => void;
}

type Tone = "neutral" | "attention" | "critical" | "normal" | "process";

interface TileProps {
  icon: IconName;
  label: string;
  /** Ausente em bloco que só leva a outra tela: nada de número inventado. */
  value?: string;
  unit?: string;
  note: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
  /** Progresso 0–1. Só entra quando a contagem é conhecida. */
  progress?: number | null;
  /** `texto` para valores em palavra; `numero` (padrão) usa a monoespaçada. */
  valueKind?: "numero" | "texto";
}

function Tile({
  icon,
  label,
  value,
  unit,
  note,
  tone = "neutral",
  action,
  progress = null,
  valueKind = "numero",
}: TileProps) {
  const body = (
    <>
      <span className={styles.tileHead}>
        <Icon name={icon} size={18} />
        <span className={styles.tileLabel}>{label}</span>
      </span>
      {value !== undefined ? (
        <strong className={`${styles.tileValue} ${valueKind === "texto" ? styles.tileValueText : ""}`}>
          {value}
          {unit ? <small>{unit}</small> : null}
        </strong>
      ) : null}
      {progress !== null ? (
        <span className={`${styles.tileProgress} ${progress < 1 ? styles.tileProgressPending : ""}`}>
          <span
            className={styles.tileProgressFill}
            style={{ width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` }}
          />
        </span>
      ) : null}
      <span className={styles.tileNote}>{note}</span>
      {action ? (
        <span className={styles.tileAction}>
          {action.label}
          <Icon name="arrowRight" size={16} />
        </span>
      ) : null}
    </>
  );

  const className = `${styles.tile} ${styles[`tone_${tone}`]}`;

  return action ? (
    <button type="button" className={`${className} ${styles.tileButton}`} onClick={action.onClick}>
      {body}
    </button>
  ) : (
    <article className={className}>{body}</article>
  );
}

/** Concorda a unidade com a quantidade, para não escrever "1 produtos". */
const unit = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

export default function ControlCenter({
  products,
  productsLoading,
  integrations,
  integrationsUnavailable,
  inventory,
  inventoryError,
  divergences,
  divergencesLoading,
  divergencesError,
  onNavigate,
}: ControlCenterProps) {
  const inventoryReady = inventory?.ready === true;
  const inventoryPending = inventory
    ? Math.max(inventory.total_products - inventory.recorded_products, 0)
    : null;
  const inventoryProgress =
    inventory && inventory.total_products > 0
      ? inventory.recorded_products / inventory.total_products
      : null;

  const divergenceCritical = divergences?.critical_count ?? null;
  const divergenceAttention = divergences?.attention_count ?? null;
  // Só as peças que pedem ação: a condição de origem (peça produzida antes de
  // existir transferência) não é alarme de painel.
  const divergenceProducts = divergences
    ? new Set(
        divergences.items
          .filter((item) => item.classe !== "origem")
          .map((item) => item.product_id),
      ).size
    : 0;

  const connectedSources = integrationsUnavailable
    ? 0
    : integrations.filter((integration) => {
        const tone = getIntegrationPresentation(integration).tone;
        return tone === "success" || tone === "info";
      }).length;

  return (
    <section className={styles.rail} aria-label="Situação geral do controle">
      <Tile
        icon="package"
        label="Peças controladas"
        value={productsLoading && !products.length ? MISSING_LABEL : formatPieces(products.length)}
        unit={products.length ? unit(products.length, "peça", "peças") : undefined}
        note={productsLoading && !products.length ? "Consultando o catálogo" : "Com roteiro produtivo cadastrado"}
      />

      <Tile
        icon={divergenceCritical ? "critical" : "alert"}
        label="Divergências abertas"
        value={
          divergencesError
            ? MISSING_LABEL
            : divergences
              ? formatPieces((divergenceCritical ?? 0) + (divergenceAttention ?? 0))
              : "Consultando"
        }
        valueKind={divergences && !divergencesError ? "numero" : "texto"}
        unit={
          divergences && !divergencesError
            ? unit((divergenceCritical ?? 0) + (divergenceAttention ?? 0), "divergência", "divergências")
            : undefined
        }
        note={
          divergencesError
            ? divergencesError
            : divergencesLoading && !divergences
              ? "Conferindo as 13 peças contra a rastreabilidade"
              : divergences
                ? divergenceCritical
                  ? `${divergenceCritical} ${unit(divergenceCritical, "crítica", "críticas")} · ${divergenceProducts} ${unit(divergenceProducts, "peça", "peças")}`
                  : divergenceAttention
                    ? `Nenhuma crítica · ${divergenceProducts} ${unit(divergenceProducts, "peça afetada", "peças afetadas")}`
                    : "Nenhuma divergência nas 13 peças"
                : "Divergências ainda não consultadas"
        }
        tone={
          divergencesError
            ? "critical"
            : !divergences
              ? "neutral"
              : divergenceCritical
                ? "critical"
                : divergenceAttention
                  ? "attention"
                  : "normal"
        }
        action={{ label: "Abrir divergências", onClick: () => onNavigate("divergencias") }}
      />

      <Tile
        icon="layers"
        label="Inventário de abertura"
        value={
          inventoryError || !inventory
            ? MISSING_LABEL
            : inventoryReady
              ? "Concluído"
              : formatPieces(inventoryPending)
        }
        unit={
          !inventoryError && inventory && !inventoryReady
            ? unit(inventoryPending ?? 0, "pendente", "pendentes")
            : undefined
        }
        note={
          inventoryError
            ? inventoryError
            : inventory
              ? `Referência ${inventory.reference_date_label} · ${inventory.recorded_products} de ${inventory.total_products} produtos`
              : "Consultando o inventário"
        }
        tone={inventoryError ? "critical" : inventoryReady ? "normal" : "attention"}
        valueKind={inventoryError || !inventory || inventoryReady ? "texto" : "numero"}
        progress={inventoryError ? null : inventoryProgress}
        action={{ label: "Abrir inventário", onClick: () => onNavigate("inventario") }}
      />

      {/* Sem valor: contar os lotes exigiria varrer as 13 peças no TOTVS a
          cada abertura do painel. O bloco leva à tela que já faz isso. */}
      <Tile
        icon="lot"
        label="Lotes de vergalhão"
        note="Fechado, em processo ou consumido, por peça"
        tone="neutral"
        action={{ label: "Abrir lotes", onClick: () => onNavigate("lotes") }}
      />

      <Tile
        icon="database"
        label="Fontes de dados"
        value={
          integrationsUnavailable
            ? MISSING_LABEL
            : `${connectedSources}/${integrations.length || 0}`
        }
        unit={integrationsUnavailable ? undefined : "conectadas"}
        note={
          integrationsUnavailable
            ? "Não foi possível consultar /api/overview"
            : integrations.length
              ? integrations
                  .map((item) => `${item.name}: ${getIntegrationPresentation(item).label}`)
                  .join(" · ")
              : "Fontes ainda não informadas"
        }
        tone={integrationsUnavailable ? "critical" : "normal"}
      />
    </section>
  );
}
