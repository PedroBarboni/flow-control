import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OverviewProduct, StageRow, TraceabilityPayload } from "../../api/types";
import { buildProductionFlow } from "../../lib/productionFlow";
import ProductionRoute from "./ProductionRoute";

const stages: StageRow[] = [
  {
    name: "Corte",
    tracking_name: "Corte",
    machine: "SERRA 01",
    totvs_code: "5177",
    status: "normal",
    reported: 1947,
    loss: 8,
    waiting: 0,
    unit_weight_kg: 0.27,
    rejection_scrap_kg: 2.16,
    total_scrap_kg: 5.4,
    awaiting_pieces: 0,
    unidentified_waiting_pieces: 125,
    awaiting_pieces_total: 125,
    in_process_pieces: 30,
    guarded_pieces: 0,
    last_date: "2026-09-01",
  },
  {
    name: "Forja",
    tracking_name: "Forja",
    machine: "FORJA 03",
    totvs_code: "125178",
    status: "attention",
    reported: null,
    loss: null,
    waiting: null,
    unit_weight_kg: 0.27,
    total_scrap_kg: null,
    awaiting_pieces_total: null,
  },
];

const product = { name: "Suporte 160", visible_wip: 155, stages } as unknown as OverviewProduct;

describe("rota de produção", () => {
  it("lista as operações com identificação, produção e fila", () => {
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Corte" })).toBeInTheDocument();
    expect(screen.getByText("5177")).toBeInTheDocument();
    expect(screen.getByText("SERRA 01")).toBeInTheDocument();
    expect(screen.getAllByText("1.947").length).toBeGreaterThan(0);
    expect(screen.getByText(/125 apontadas nesta etapa sem origem rastreada/)).toBeInTheDocument();
  });

  it("destaca o saldo de chão de fábrica separado do acumulado do período", () => {
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    const corte = screen.getByRole("heading", { name: "Corte" }).closest("li") as HTMLElement;

    // O que está parado na bancada agora fica fora da grade de acumulados:
    // "produzidas" é fluxo do período e era lido como estoque.
    const chao = within(corte).getByText("No chão de fábrica").parentElement as HTMLElement;
    expect(within(chao).getByText("125")).toBeInTheDocument();
    expect(
      within(chao).getByText(/125 apontadas nesta etapa sem origem rastreada/),
    ).toBeInTheDocument();

    // O acumulado continua no cartão, com nome que não se confunde com saldo.
    expect(within(corte).getByText("Produzidas no período")).toBeInTheDocument();
    expect(within(chao).queryByText("1.947")).not.toBeInTheDocument();
  });

  it("mostra a pilha no cartão de quem a produziu, nomeando o destino", () => {
    // O que saiu do Corte e espera a Forja está fisicamente na saída do
    // Corte: é lá que o operador procura, não no cartão da Forja.
    const comFila: StageRow[] = stages.map((row) =>
      row.name === "Corte"
        ? { ...row, awaiting_pieces: 11203, awaiting_pieces_total: 11203, unidentified_waiting_pieces: 0 }
        : row,
    );
    // A composição vem da rastreabilidade da etapa SEGUINTE: a pilha que o
    // Corte deixou é exatamente a fila que a Forja vai consumir.
    const trace = {
      product_id: "suporte-160",
      material: { active_lot_id: null, initial_kg: null, consumed_kg: null, remaining_kg: null, method: "calculado", lots: [] },
      stages: [
        {
          process: "FORJA",
          available_pieces: 11203,
          identified_pieces: 11193,
          opening_pieces: 10,
          unmatched_pieces: 0,
          lots: [],
        },
      ],
      unmatched_pieces: 0,
      unmatched: [],
      source_status: {},
    } as unknown as TraceabilityPayload;

    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(comFila, trace)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    const corte = screen.getByRole("heading", { name: "Corte" }).closest("li") as HTMLElement;
    expect(within(corte).getByText("11.203")).toBeInTheDocument();
    // Número e nota descrevem a MESMA pilha: 10 + 11.193 = 11.203.
    expect(
      within(corte).getByText(
        /Aguardando a etapa Forja · 10 do inventário de abertura · 11\.193 com lote oficial/,
      ),
    ).toBeInTheDocument();
    expect(within(corte).queryByText(/destino/i)).not.toBeInTheDocument();

    // E não sobra no cartão da Forja, onde ninguém procuraria por ela.
    const forja = screen.getByRole("heading", { name: "Forja" }).closest("li") as HTMLElement;
    expect(within(forja).queryByText("11.203")).not.toBeInTheDocument();
  });

  it("não conta peça pronta do fim da rota como parada no chão de fábrica", () => {
    // A Solda é apontada como Pré-acabado e entrega peça PRONTA: o que é
    // apontado ali já está em "produzidas", e repetir como parado contaria a
    // mesma peça duas vezes.
    const ultima = stages[stages.length - 1];
    const comSemOrigem: StageRow[] = stages.map((row) =>
      row === ultima
        ? { ...row, awaiting_pieces: 0, awaiting_pieces_total: 0, unidentified_waiting_pieces: 2710 }
        : row,
    );

    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(comSemOrigem, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    const nome = ultima.tracking_name || ultima.name;
    const cartao = screen.getByRole("heading", { name: nome }).closest("li") as HTMLElement;
    expect(within(cartao).getByText(/Peça pré-acabada ao fim da etapa/)).toBeInTheDocument();
    // O número grande é o que está parado — e não há nada parado depois dela.
    expect(within(cartao).queryByText("2.710")).not.toBeInTheDocument();
    // Mas a falta de lote não some: fica nomeada, e vive em Divergências.
    expect(within(cartao).getByText(/sem origem rastreada/)).toBeInTheDocument();
  });

  it("não chama a Eixo de pré-acabada: ela é componente da Solda do Placa", () => {
    const eixo = {
      ...product,
      route_output: "componente",
    } as unknown as OverviewProduct;

    render(
      <ProductionRoute
        product={eixo}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    const ultima = stages[stages.length - 1];
    const nome = ultima.tracking_name || ultima.name;
    const cartao = screen.getByRole("heading", { name: nome }).closest("li") as HTMLElement;
    expect(within(cartao).getByText(/Componente pronto ao fim da etapa/)).toBeInTheDocument();
    expect(within(cartao).queryByText(/pré-acabada/)).not.toBeInTheDocument();
  });

  it("mostra ausência de apontamento como travessão, nunca como zero", () => {
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    const forja = screen.getByRole("heading", { name: "Forja" }).closest("li") as HTMLElement;
    expect(forja).toHaveTextContent("—");
    expect(forja).toHaveTextContent("Sem apontamentos no período");
  });

  it("avisa quando a rastreabilidade por lote não respondeu", () => {
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError="Rastreabilidade indisponível."
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/não como zero/i);
  });

  it("usa ícones vetoriais, sem emoji", () => {
    const { container } = render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(container.textContent ?? "").not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("abre a auditoria da operação escolhida", async () => {
    const onAudit = vi.fn();
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={onAudit}
        onMaterialAudit={() => {}}
      />,
    );

    const corte = screen.getByRole("heading", { name: "Corte" }).closest("li") as HTMLElement;
    await userEvent.click(within(corte).getByRole("button", { name: /abrir detalhes/i }));
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ tracking_name: "Corte" }));
  });

  it("mostra a etapa 0 com o saldo de vergalhão restante", () => {
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={() => {}}
      />,
    );

    expect(screen.getByText("00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vergalhão" })).toBeInTheDocument();
  });

  it("aciona a auditoria de material ao abrir a etapa 0", async () => {
    const onMaterialAudit = vi.fn();
    render(
      <ProductionRoute
        product={product}
        flow={buildProductionFlow(stages, null)}
        traceabilityError=""
        onAudit={() => {}}
        onMaterialAudit={onMaterialAudit}
      />,
    );

    const vergalhao = screen.getByRole("heading", { name: "Vergalhão" }).closest("li") as HTMLElement;
    await userEvent.click(within(vergalhao).getByRole("button", { name: /abrir detalhes/i }));
    expect(onMaterialAudit).toHaveBeenCalled();
  });
});
