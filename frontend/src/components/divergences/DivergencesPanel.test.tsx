import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DivergenceItem, DivergencesPayload } from "../../api/types";
import DivergencesPanel from "./DivergencesPanel";

function item(overrides: Partial<DivergenceItem>): DivergenceItem {
  return {
    product_id: "suporte_160",
    product_name: "Suporte 160",
    kind: "pecas_sem_lote",
    classe: "acao",
    severity: "critical",
    reference: "PRE-ACABADO",
    quantity: 1572,
    unit: "peças",
    reason: "Apontou mais do que a Usinagem entregou",
    diagnosis: [],
    possible_causes: ["Apontamento em duplicidade"],
    ...overrides,
  };
}

function payload(items: DivergenceItem[]): DivergencesPayload {
  const acao = items.filter((row) => row.classe !== "origem");
  const origem = items.filter((row) => row.classe === "origem");
  return {
    generated_at: "2026-09-04T08:00:00",
    items,
    critical_count: acao.filter((row) => row.severity === "critical").length,
    attention_count: acao.filter((row) => row.severity === "attention").length,
    action_count: acao.length,
    origin_count: origem.length,
    origin_pieces: origem.reduce((total, row) => total + (row.quantity ?? 0), 0),
  };
}

const noop = () => {};

describe("DivergencesPanel", () => {
  it("separa o que pede ação da condição de origem", () => {
    render(
      <DivergencesPanel
        divergences={payload([
          item({}),
          item({
            product_id: "eixo_160",
            product_name: "Eixo 160",
            classe: "origem",
            quantity: 4974,
            reason: "Peça produzida antes de existir transferência de vergalhão",
          }),
        ])}
        loading={false}
        error=""
        onReload={noop}
        onOpenProduct={noop}
      />,
    );

    const criticas = screen.getByRole("region", { name: /críticas/i });
    expect(within(criticas).getByText("Suporte 160")).toBeInTheDocument();
    expect(within(criticas).queryByText("Eixo 160")).not.toBeInTheDocument();

    const origem = screen.getByText("Sem lote por origem").closest("details");
    expect(origem).not.toBeNull();
    expect(within(origem as HTMLElement).getByText("Eixo 160")).toBeInTheDocument();
    // Recolhida: não há o que fazer a respeito.
    expect((origem as HTMLDetailsElement).open).toBe(false);
  });

  it("não conta a condição de origem como divergência pendente", () => {
    render(
      <DivergencesPanel
        divergences={payload([
          item({
            product_id: "conector_at",
            product_name: "Conector AT",
            classe: "origem",
            severity: "critical",
          }),
        ])}
        loading={false}
        error=""
        onReload={noop}
        onOpenProduct={noop}
      />,
    );

    expect(screen.getByText("Nada pedindo ação")).toBeInTheDocument();
    const criticas = screen.getByText("Críticas").closest("div");
    expect(within(criticas as HTMLElement).getByText("0")).toBeInTheDocument();
  });

  it("mostra o que foi apurado antes das hipóteses genéricas", async () => {
    render(
      <DivergencesPanel
        divergences={payload([
          item({
            diagnosis: [
              "04/09: Pré-acabado apontou 2.135 peças e Usinagem apontou 0 — 1.572 ficaram sem origem.",
              "Há 4.547 peças paradas aguardando a etapa Usinagem. Apontar essa operação fecha a conta.",
            ],
          }),
        ])}
        loading={false}
        error=""
        onReload={noop}
        onOpenProduct={noop}
      />,
    );

    // O apurado fica visível de cara: é ele que vira ordem de serviço.
    expect(screen.getByText(/Usinagem apontou 0/)).toBeInTheDocument();
    expect(screen.getByText(/4\.547 peças paradas/)).toBeInTheDocument();

    // A hipótese genérica é rebaixada a consulta, recolhida.
    const hipoteses = screen.getByText("Outros motivos possíveis").closest("details");
    expect((hipoteses as HTMLDetailsElement).open).toBe(false);
  });

  it("mantém as hipóteses à mostra quando não há o que apurar", () => {
    render(
      <DivergencesPanel
        divergences={payload([item({ diagnosis: [] })])}
        loading={false}
        error=""
        onReload={noop}
        onOpenProduct={noop}
      />,
    );

    expect(screen.getByText("Motivos possíveis")).toBeInTheDocument();
    expect(screen.queryByText("O que foi apurado")).not.toBeInTheDocument();
  });

  it("leva para a peça ao clicar no nome, também na lista de origem", async () => {
    const onOpenProduct = vi.fn();
    render(
      <DivergencesPanel
        divergences={payload([item({ classe: "origem", product_id: "eixo_400", product_name: "Eixo 400" })])}
        loading={false}
        error=""
        onReload={noop}
        onOpenProduct={onOpenProduct}
      />,
    );

    screen.getByRole("button", { name: "Eixo 400" }).click();
    expect(onOpenProduct).toHaveBeenCalledWith("eixo_400");
  });
});
