/**
 * Estado das fontes de dados.
 *
 * Disponibilidade e latência ficam separadas: uma consulta sob demanda não é
 * apresentada como conexão em tempo real.
 */

import type { Integration } from "../api/types";

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export interface IntegrationPresentation {
  tone: Tone;
  label: string;
  detail: string;
}

const STATUS_LABELS: Record<string, IntegrationPresentation> = {
  offline: { tone: "danger", label: "Indisponível", detail: "Fonte de dados indisponível" },
  error: { tone: "danger", label: "Indisponível", detail: "Fonte de dados indisponível" },
  not_configured: { tone: "warning", label: "Não configurado", detail: "Configure a fonte de dados" },
  no_data: { tone: "info", label: "Sem dados no período", detail: "Nenhum registro no período selecionado" },
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, "_");
}

function customDetail(integration: Partial<Integration> | undefined, fallback: string): string {
  return integration?.detail || integration?.message || fallback;
}

export function getIntegrationPresentation(
  integration: Partial<Integration> = {},
): IntegrationPresentation {
  const source = integration ?? {};
  const status = normalize(source.status);
  const latency = normalize(source.latency);

  const known = STATUS_LABELS[status];
  if (known) return { ...known, detail: customDetail(source, known.detail) };

  if (["unconfigured", "config_missing", "pending"].includes(status)) {
    const state = STATUS_LABELS.not_configured;
    return { ...state, detail: customDetail(source, state.detail) };
  }

  if (["empty", "no_records", "without_data"].includes(status)) {
    const state = STATUS_LABELS.no_data;
    return { ...state, detail: customDetail(source, state.detail) };
  }

  if (["unavailable", "indisponivel"].includes(status)) {
    const state = STATUS_LABELS.offline;
    return { ...state, detail: customDetail(source, state.detail) };
  }

  if (["sob_demanda", "on_demand", "ondemand"].includes(status)) {
    return { tone: "info", label: "Sob demanda", detail: "Consulta quando necessário" };
  }

  if (["tempo_real", "real_time", "realtime", "live"].includes(status)) {
    return { tone: "success", label: "Tempo real", detail: "Atualização contínua" };
  }

  if (["sob_demanda", "on_demand", "ondemand"].includes(latency)) {
    return { tone: "info", label: "Sob demanda", detail: "Consulta quando necessário" };
  }

  if (["tempo_real", "real_time", "realtime", "live"].includes(latency)) {
    return { tone: "success", label: "Tempo real", detail: "Atualização contínua" };
  }

  if (["online", "connected", "active", "ready"].includes(status)) {
    return { tone: "success", label: "Disponível", detail: customDetail(source, "Integração ativa") };
  }

  return { tone: "info", label: "Sem dados", detail: customDetail(source, "Estado da integração não informado") };
}
