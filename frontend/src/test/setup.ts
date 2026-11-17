import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// O jsdom não implementa rolagem; a aplicação usa scrollTo apenas para voltar
// ao topo após a navegação. O stub evita ruído sem alterar o comportamento sob teste.
Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });

// `globals: false` mantém as importações explícitas; a limpeza entre testes
// precisa então ser registrada aqui.
afterEach(() => {
  cleanup();
});
