/**
 * Cliente único das APIs do Flow Control.
 *
 * Regras: toda consulta aceita AbortSignal para que uma navegação substitua a
 * anterior sem corrida; nenhum erro é convertido em dado; a mensagem devolvida
 * pela API é preservada para o operador.
 */

import type {
  CatalogProduct,
  CatalogProductionPayload,
  DetailPayload,
  DivergencesPayload,
  InventoryPayload,
  InventorySavePayload,
  MaterialLotsPayload,
  MovementsPayload,
  OverviewPayload,
  ReadinessPayload,
  TotvsPayload,
  TraceabilityPayload,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === "AbortError" : (error as Error)?.name === "AbortError";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      ...init,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("Não foi possível falar com o servidor do controle.", 0);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string; message?: string };
      detail = body?.detail || body?.message || "";
    } catch {
      detail = "";
    }
    throw new ApiError(detail || `A consulta retornou HTTP ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

const search = (params: Record<string, string | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

export interface Period {
  from: string;
  to: string;
}

export const api = {
  products: (signal?: AbortSignal) => request<CatalogProduct[]>("/api/products", { signal }),

  catalogProduction: (period: Period, signal?: AbortSignal) =>
    request<CatalogProductionPayload>(
      `/api/catalog/production${search({ date_from: period.from, date_to: period.to })}`,
      { signal },
    ),

  overview: (productId: string | undefined, period: Period, signal?: AbortSignal) =>
    request<OverviewPayload>(
      `/api/overview${search({ product_id: productId, date_from: period.from, date_to: period.to })}`,
      { signal },
    ),

  readiness: (signal?: AbortSignal) => request<ReadinessPayload>("/api/readiness", { signal }),

  divergences: (signal?: AbortSignal) => request<DivergencesPayload>("/api/divergences", { signal }),

  inventory: (signal?: AbortSignal) => request<InventoryPayload>("/api/inventory/opening", { signal }),

  saveInventory: (productId: string, payload: InventorySavePayload, signal?: AbortSignal) =>
    request<{ status: string; product_id: string; updated_at: string }>(
      `/api/inventory/opening/${encodeURIComponent(productId)}`,
      { method: "PUT", body: JSON.stringify(payload), signal },
    ),

  materialLots: (signal?: AbortSignal) => request<MaterialLotsPayload>("/api/material-lots", { signal }),

  movements: (productId: string, beforeId?: number | null, signal?: AbortSignal) =>
    request<MovementsPayload>(
      `/api/movements/${encodeURIComponent(productId)}${search({
        limit: "50",
        before_id: beforeId ? String(beforeId) : undefined,
      })}`,
      { signal },
    ),

  totvs: (productId: string, signal?: AbortSignal) =>
    request<TotvsPayload>(`/api/totvs/${encodeURIComponent(productId)}`, { signal }),

  traceability: (productId: string, period: Period, signal?: AbortSignal) =>
    request<TraceabilityPayload>(
      `/api/traceability/${encodeURIComponent(productId)}/summary${search({
        date_from: period.from,
        date_to: period.to,
      })}`,
      { signal },
    ),

  detail: (topic: string, productId: string, period: Period, signal?: AbortSignal) =>
    request<DetailPayload>(
      `/api/details/${encodeURIComponent(topic)}${search({
        product_id: productId,
        date_from: period.from,
        date_to: period.to,
      })}`,
      { signal },
    ),
};
