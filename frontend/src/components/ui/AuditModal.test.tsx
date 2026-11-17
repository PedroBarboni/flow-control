import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AuditModal from "./AuditModal";

const detail = {
  title: "Forja",
  source: "PostgreSQL / Apontamentos",
  rows: [
    ["Código da peça", "135205"],
    ["Quantidade produzida", "1.550 peças"],
    ["Consumo calculado", "363,375 kg · calculado"],
    ["Saldo do lote", "Não informado"],
  ] as [string, string][],
};

describe("modal de auditoria", () => {
  it("é um diálogo rotulado, com foco inicial dentro dele", () => {
    render(<AuditModal detail={detail} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Forja" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("preserva os valores e distingue oficial de calculado e ausente", () => {
    render(<AuditModal detail={detail} onClose={() => {}} />);
    expect(screen.getByText("1.550 peças")).toBeInTheDocument();
    expect(screen.getByText("363,375 kg · calculado")).toBeInTheDocument();
    expect(screen.getByText("Não informado")).toBeInTheDocument();
  });

  it("fecha com Escape e com o botão dedicado", async () => {
    const onClose = vi.fn();
    render(<AuditModal detail={detail} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /fechar auditoria/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole("button", { name: /fechar detalhes/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("devolve o foco ao elemento que abriu o diálogo", () => {
    function Host({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">Abrir detalhes</button>
          {open ? <AuditModal detail={detail} onClose={() => {}} /> : null}
        </>
      );
    }

    const { rerender } = render(<Host open={false} />);
    const origin = screen.getByRole("button", { name: "Abrir detalhes" });
    origin.focus();
    expect(document.activeElement).toBe(origin);

    rerender(<Host open />);
    expect(document.activeElement).not.toBe(origin);

    rerender(<Host open={false} />);
    expect(document.activeElement).toBe(origin);
  });

  it("mantém o foco preso dentro do diálogo ao tabular", async () => {
    render(<AuditModal detail={detail} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Forja" });

    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
