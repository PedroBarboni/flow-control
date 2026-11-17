import { useEffect, useState } from "react";
import styles from "./Ui.module.css";
import Icon from "./Icon";

interface AsyncStateProps {
  state: "loading" | "error" | "empty";
  title: string;
  message?: string;
  compact?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * Esqueleto no formato do conteúdo que está vindo. `cards` para grades de
   * peça/divergência, `rows` para listas e tabelas, `none` quando o espaço já
   * é pequeno demais para valer a pena.
   */
  skeleton?: "cards" | "rows" | "none";
}

const VARIANT = {
  loading: styles.stateLoading,
  error: styles.stateError,
  empty: styles.stateEmpty,
} as const;

/**
 * Cronômetro da espera.
 *
 * A varredura das 13 peças conversa com o TOTVS peça a peça e passa de um
 * minuto. Sem contador o operador não distingue "demorando" de "travou" e
 * recarrega a página no meio da consulta. Fica fora do `aria-live`: o leitor
 * de tela anuncia o título uma vez, não um número novo a cada segundo.
 */
function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (seconds < 1) return null;
  const label = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return (
    <span className={`${styles.stateElapsed} fc-mono`} aria-hidden="true">
      {label}
    </span>
  );
}

function Skeleton({ variant }: { variant: "cards" | "rows" }) {
  const count = variant === "cards" ? 3 : 4;
  return (
    <div
      className={variant === "cards" ? styles.skeletonCards : styles.skeletonRows}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonBlock}>
          <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          <span className={styles.skeletonLine} />
          {variant === "cards" ? (
            <span className={`${styles.skeletonLine} ${styles.skeletonLineFigure}`} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Estado assíncrono com espaço reservado, para que a chegada dos dados não
 * desloque a tela. Erros são anunciados por `aria-live`.
 */
export default function AsyncState({
  state,
  title,
  message,
  compact = false,
  onRetry,
  retryLabel = "Tentar novamente",
  skeleton = "none",
}: AsyncStateProps) {
  const loading = state === "loading";
  return (
    <div
      className={`${styles.state} ${VARIANT[state]} ${compact ? styles.stateCompact : ""}`}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
      aria-busy={loading || undefined}
    >
      <div className={styles.stateRow}>
        {loading ? <span className={styles.stateSpinner} aria-hidden="true" /> : null}
        {state === "error" ? <Icon name="critical" /> : null}
        {state === "empty" ? <Icon name="info" /> : null}
        <strong className={styles.stateTitle}>{title}</strong>
        {loading ? <ElapsedTime /> : null}
      </div>
      {message ? <p className={styles.stateMessage}>{message}</p> : null}
      {loading ? <span className={styles.stateBar} aria-hidden="true" /> : null}
      {loading && skeleton !== "none" ? <Skeleton variant={skeleton} /> : null}
      {onRetry ? (
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={onRetry}>
          <Icon name="refresh" size={18} />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
