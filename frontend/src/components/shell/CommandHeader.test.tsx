import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommandHeader from "./CommandHeader";

const integrations = [
  { name: "TOTVS", status: "online", latency: "sob demanda" },
  { name: "Apontamentos", status: "online", latency: "tempo real" },
];

describe("faixa de comando", () => {
  it("mostra somente destinos utilizáveis", () => {
    render(
      <CommandHeader
        activeNav="central"
        onNavigate={() => {}}
        search=""
        onSearch={() => {}}
        integrations={integrations}
        integrationsUnavailable={false}
      />,
    );

    const nav = screen.getByRole("navigation", { name: /navegação principal/i });
    const destinations = within(nav).getAllByRole("button").map((button) => button.textContent);
    expect(destinations).toEqual(["Central", "Inventário", "Lotes", "Divergências"]);
    expect(screen.queryByText(/Em preparação/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Histórico/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Administração/i)).not.toBeInTheDocument();
  });

  it("separa disponibilidade de latência nas fontes", () => {
    render(
      <CommandHeader
        activeNav="central"
        onNavigate={() => {}}
        search=""
        onSearch={() => {}}
        integrations={integrations}
        integrationsUnavailable={false}
      />,
    );

    expect(screen.getByText(/TOTVS · Sob demanda/)).toBeInTheDocument();
    expect(screen.getByText(/Apontamentos · Tempo real/)).toBeInTheDocument();
  });

  it("declara as fontes indisponíveis sem presumir conexão", () => {
    render(
      <CommandHeader
        activeNav="central"
        onNavigate={() => {}}
        search=""
        onSearch={() => {}}
        integrations={[]}
        integrationsUnavailable
      />,
    );
    expect(screen.getByText(/Fontes · Indisponíveis/)).toBeInTheDocument();
  });

  it("marca o destino atual e navega ao clique", async () => {
    const onNavigate = vi.fn();
    render(
      <CommandHeader
        activeNav="inventario"
        onNavigate={onNavigate}
        search=""
        onSearch={() => {}}
        integrations={integrations}
        integrationsUnavailable={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Inventário" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Lotes" }));
    expect(onNavigate).toHaveBeenCalledWith("lotes");
  });

  it("expõe a busca com rótulo acessível", async () => {
    const onSearch = vi.fn();
    render(
      <CommandHeader
        activeNav="central"
        onNavigate={() => {}}
        search=""
        onSearch={onSearch}
        integrations={integrations}
        integrationsUnavailable={false}
      />,
    );

    const input = screen.getByRole("searchbox", { name: /buscar peça/i });
    await userEvent.type(input, "conector");
    expect(onSearch).toHaveBeenCalled();
  });
});
