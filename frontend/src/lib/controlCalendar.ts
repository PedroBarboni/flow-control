/** Períodos do controle. O ciclo atual reinicia em 01/09/2026. */

export interface PeriodRange {
  from: string;
  to: string;
}

export const periods = [
  "Ciclo atual",
  "Setembro de 2026",
  "Agosto de 2026",
  "Julho de 2026",
  "Últimos 30 dias",
] as const;

export type PeriodName = (typeof periods)[number];

const periodRanges: Record<string, PeriodRange> = {
  "Setembro de 2026": { from: "2026-09-01", to: "2026-09-30" },
  "Agosto de 2026": { from: "2026-08-01", to: "2026-08-31" },
  "Julho de 2026": { from: "2026-07-01", to: "2026-07-31" },
};

const isoLocal = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getPeriodRange = (period: string, now: Date = new Date()): PeriodRange => {
  const fixed = periodRanges[period];
  if (fixed) return fixed;

  const end = new Date(now);
  if (period === "Ciclo atual") {
    const reset = new Date(2026, 8, 1, 0, 0, 0);
    return {
      from: end >= reset ? "2026-09-01" : "2026-08-28",
      to: isoLocal(end),
    };
  }

  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { from: isoLocal(start), to: isoLocal(end) };
};
