import { vi } from "vitest";

export interface RouteMap {
  [pattern: string]: { status?: number; body: unknown } | (() => { status?: number; body: unknown });
}

/**
 * Servidor falso das APIs do controle.
 *
 * Rotas não declaradas respondem 503 com detalhe, para que os testes exercitem
 * o comportamento real de indisponibilidade em vez de dados inventados.
 */
export function mockApi(routes: RouteMap) {
  const calls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (init?.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }

    // A rota mais específica vence, para que um caso possa sobrescrever o padrão.
    const key = Object.keys(routes)
      .filter((pattern) => url.startsWith(pattern))
      .sort((left, right) => right.length - left.length)[0];
    if (!key) {
      return new Response(JSON.stringify({ detail: `Rota não simulada: ${url}` }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const entry = routes[key];
    const resolved = typeof entry === "function" ? entry() : entry;
    return new Response(JSON.stringify(resolved.body), {
      status: resolved.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

export const emptyInventory = {
  reference_date: "2026-09-01",
  reference_date_label: "01/09/2026",
  rows: [],
  recorded_positions: 0,
  recorded_products: 0,
  total_products: 1,
  pending_product_ids: ["conector-at"],
  ready: false,
};

export const emptyMaterialLots = {
  generated_at: "2026-09-01T09:00:00",
  items: [],
  counts: { fechado: 0, em_processo: 0, consumido: 0 },
};

export const catalogProducts = [
  {
    id: "conector-at",
    name: "Conector AT",
    code: "5205",
    rod: "VERGALHAO LATAO 15,880",
    rod_diameter_mm: "15.880",
    rod_available: true,
    rod_material: "LATÃO 377 1/2 DURO",
    stages: ["Corte", "Forja"],
    totvs_destination_codes: ["5205", "135205"],
    totvs_destination_code_stages: { "5205": "BLANK", "135205": "FORJA" },
    tracking_stages: [
      { code: "5205", stage: "BLANK", process: "Corte", weight_kg: 0.141, machine: "TORNO", scrap_to_next_kg_per_piece: 0.034 },
      { code: "135205", stage: "FORJA", process: "Forja", weight_kg: 0.107, machine: "FORJA 1", scrap_to_next_kg_per_piece: 0.009 },
    ],
    blank_weight_kg: 0.141,
    pieces_per_kg: 7.092,
    status: "active",
  },
];

export const catalogProduction = {
  period: { from: "2026-09-01", to: "2026-09-01" },
  source: "PostgreSQL / Apontamentos + lotes do controle",
  available: true,
  message: "Produção consultada no período",
  rows: [
    {
      product_id: "conector-at",
      produced_pieces: 12450,
      in_process_pieces: 1280,
      identified_in_process_pieces: 1280,
      unidentified_in_process_pieces: 0,
      last_production_date: "2026-09-01",
      attention: false,
      critical: false,
    },
  ],
};

export const overviewWithoutProduct = {
  system_name: "Central de Controle",
  updated_at: "2026-09-01T09:00:00",
  integrations: [
    { name: "TOTVS", status: "online", latency: "sob demanda" },
    { name: "Apontamentos", status: "online", latency: "tempo real" },
  ],
  totals: { wallet: 0, finished: 0, wip: 0, warehouse_kg: 0, critical_alerts: 0 },
  product: null,
};
