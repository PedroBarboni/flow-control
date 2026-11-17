import type { ReactNode } from "react";
import styles from "./Ui.module.css";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

interface StatusBadgeProps {
  tone?: BadgeTone;
  detail?: string;
  children: ReactNode;
}

/**
 * Selo de estado. A forma da marca muda com o tom, para que o estado não
 * dependa apenas da cor.
 */
export default function StatusBadge({ tone = "neutral", detail, children }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={detail}>
      <i className={styles.badgeMark} aria-hidden="true" />
      {children}
    </span>
  );
}
