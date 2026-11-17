import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// A interface oficial é o build React servido pelo FastAPI em /frontend/dist.
// Nenhum recurso é carregado por CDN: fontes, ícones e estilos são locais.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5027",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    globals: false,
    restoreMocks: true,
  },
});
