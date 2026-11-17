/**
 * Formatação operacional em pt-BR.
 *
 * Ausência de dado nunca vira zero: valores indisponíveis são apresentados
 * como travessão. Zero oficial continua sendo `0`.
 */

export const MISSING_VALUE = "—";
export const MISSING_LABEL = "Não informado";

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export const hasNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Formata um número inteiro/decimal no padrão brasileiro. */
export function formatNumberBR(value: unknown, options: Intl.NumberFormatOptions = {}): string {
  const number = toFiniteNumber(value);
  if (number === null) return MISSING_VALUE;
  return new Intl.NumberFormat("pt-BR", options).format(number);
}

/** Formata peso com casas fixas; `null` continua indisponível. */
export function formatKgBR(value: unknown, fractionDigits = 3): string {
  const number = toFiniteNumber(value);
  if (number === null) return MISSING_VALUE;
  return `${formatNumberBR(number, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} kg`;
}

export function formatPercentBR(value: unknown, fractionDigits = 1): string {
  const number = toFiniteNumber(value);
  if (number === null) return MISSING_VALUE;
  return `${formatNumberBR(number, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/** Formata a data de calendário sem deixar o fuso do runtime alterá-la. */
export function formatDateBR(value: unknown): string {
  if (typeof value !== "string") return MISSING_VALUE;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return MISSING_VALUE;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return MISSING_VALUE;
  }

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** Data e hora curtas para registros de auditoria. */
export function formatDateTimeBR(value: unknown): string {
  if (typeof value !== "string") return MISSING_VALUE;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return formatDateBR(value);
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

/**
 * Rótulo de peças: preserva zero oficial e distingue indisponível.
 *
 * Peça é indivisível — nunca sai daqui quebrada. O motor já entrega inteiro;
 * esta é a última barreira para que nenhuma conta nova volte a mostrar
 * "1.572,457 peças" na tela.
 */
export function formatPieces(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number === null) return MISSING_VALUE;
  return formatNumberBR(Math.round(number), { maximumFractionDigits: 0 });
}
