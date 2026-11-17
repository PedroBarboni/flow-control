import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type { CatalogProductionRow } from "./api/types";
import styles from "./App.module.css";
import ControlCenter from "./components/central/ControlCenter";
import ProductCatalog from "./components/catalog/ProductCatalog";
import DivergencesPanel from "./components/divergences/DivergencesPanel";
import OpeningInventory from "./components/inventory/OpeningInventory";
import MaterialLotBoard from "./components/lots/MaterialLotBoard";
import ProductWorkspace from "./components/product/ProductWorkspace";
import CommandHeader, { type DestinationId } from "./components/shell/CommandHeader";
import AsyncState from "./components/ui/AsyncState";
import { getPeriodRange, periods } from "./lib/controlCalendar";
import { useApiResource } from "./hooks/useApiResource";

const DESTINATION_IDS: DestinationId[] = ["central", "inventario", "lotes", "divergencias"];

interface UrlState {
  nav: DestinationId;
  produto: string;
  periodo: string;
}

function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const nav = params.get("aba") as DestinationId | null;
  const periodo = params.get("periodo") || "";
  return {
    nav: nav && DESTINATION_IDS.includes(nav) ? nav : "central",
    produto: params.get("produto") || "",
    periodo: periods.includes(periodo as (typeof periods)[number]) ? periodo : "Ciclo atual",
  };
}

export default function App() {
  const initial = useRef(readUrlState());
  const [nav, setNav] = useState<DestinationId>(initial.current.nav);
  const [selectedProduct, setSelectedProduct] = useState(initial.current.produto);
  const [period, setPeriod] = useState(initial.current.periodo);
  const [search, setSearch] = useState("");
  const [unsavedInventory, setUnsavedInventory] = useState(0);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  // O contexto operacional vive na URL: recarregar não perde produto nem período.
  useEffect(() => {
    const params = new URLSearchParams();
    if (nav !== "central") params.set("aba", nav);
    if (selectedProduct) params.set("produto", selectedProduct);
    if (period !== "Ciclo atual") params.set("periodo", period);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [nav, selectedProduct, period]);

  const products = useApiResource((signal) => api.products(signal), []);
  const inventory = useApiResource((signal) => api.inventory(signal), []);
  const materialLots = useApiResource(
    (signal) => api.materialLots(signal),
    [],
    { enabled: nav === "lotes", reuseLoaded: true },
  );
  const catalogProduction = useApiResource(
    (signal) => api.catalogProduction(periodRange, signal),
    [periodRange.from, periodRange.to],
    { enabled: !selectedProduct, reuseLoaded: true },
  );
  const overview = useApiResource(
    (signal) => api.overview(selectedProduct, periodRange, signal),
    [selectedProduct, periodRange.from, periodRange.to],
  );
  const totvs = useApiResource(
    (signal) => api.totvs(selectedProduct, signal),
    [selectedProduct],
    { enabled: Boolean(selectedProduct) },
  );
  const traceability = useApiResource(
    (signal) => api.traceability(selectedProduct, periodRange, signal),
    [selectedProduct, periodRange.from, periodRange.to],
    { enabled: Boolean(selectedProduct) },
  );
  // A varredura de divergências consulta as 13 peças e demora; ela carrega em
  // paralelo com o resto do painel, que nunca fica esperando por ela.
  const divergences = useApiResource(
    (signal) => api.divergences(signal),
    [],
    { enabled: nav === "divergencias" || (nav === "central" && !selectedProduct), reuseLoaded: true },
  );

  const productionMap = useMemo(() => {
    const map = new Map<string, CatalogProductionRow>();
    for (const row of catalogProduction.data?.rows ?? []) map.set(row.product_id, row);
    return map;
  }, [catalogProduction.data]);

  const confirmLeaveInventory = useCallback((): boolean => {
    if (nav !== "inventario" || unsavedInventory === 0) return true;
    return window.confirm(
      `Há ${unsavedInventory} posição(ões) do inventário sem salvar. Sair mesmo assim?`,
    );
  }, [nav, unsavedInventory]);

  const navigate = useCallback(
    (destination: DestinationId) => {
      if (!confirmLeaveInventory()) return;
      setNav(destination);
      if (destination === "central") setSelectedProduct("");
      window.scrollTo({ top: 0 });
    },
    [confirmLeaveInventory],
  );

  const selectProduct = useCallback(
    (productId: string) => {
      if (!confirmLeaveInventory()) return;
      setSelectedProduct(productId);
      setNav("central");
      window.scrollTo({ top: 0 });
    },
    [confirmLeaveInventory],
  );

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    if (value.trim()) {
      setSelectedProduct("");
      setNav("central");
    }
  }, []);

  const product = overview.data?.product ?? null;
  const integrations = overview.data?.integrations ?? [];
  const divergenceCount = divergences.data
    ? divergences.data.critical_count + divergences.data.attention_count
    : null;

  return (
    <>
      <a className="fc-skip-link" href="#conteudo">
        Ir para o conteúdo operacional
      </a>

      <CommandHeader
        activeNav={nav}
        onNavigate={navigate}
        search={search}
        onSearch={handleSearch}
        integrations={integrations}
        integrationsUnavailable={Boolean(overview.error)}
        divergenceCount={divergenceCount}
      />

      <main className={styles.shell} id="conteudo">
        {nav === "central" && !selectedProduct ? (
          <>
            <ControlCenter
              products={products.data ?? []}
              productsLoading={products.loading}
              integrations={integrations}
              integrationsUnavailable={Boolean(overview.error)}
              inventory={inventory.data}
              inventoryError={inventory.error}
              divergences={divergences.data}
              divergencesLoading={divergences.loading}
              divergencesError={divergences.error}
              onNavigate={navigate}
            />

            {products.loading && !products.data ? (
              <AsyncState
                state="loading"
                title="Consultando o catálogo de peças"
                message="Buscando as peças com roteiro produtivo cadastrado."
                skeleton="cards"
              />
            ) : products.error ? (
              <AsyncState
                state="error"
                title="Catálogo indisponível"
                message={`${products.error} Nenhuma peça foi presumida.`}
                onRetry={products.reload}
              />
            ) : (
              <ProductCatalog
                products={products.data ?? []}
                production={productionMap}
                productionAvailable={catalogProduction.data?.available === true}
                productionMessage={
                  catalogProduction.error ||
                  catalogProduction.data?.message ||
                  "Produção do período ainda não consultada"
                }
                search={search}
                onSelect={selectProduct}
              />
            )}
          </>
        ) : null}

        {nav === "central" && selectedProduct ? (
          overview.loading && !product ? (
            <AsyncState
              state="loading"
              title="Abrindo o controle da peça"
              message="Consultando apontamentos, lotes e rastreabilidade."
              skeleton="rows"
            />
          ) : overview.error || !product ? (
            <AsyncState
              state="error"
              title="Não foi possível abrir a peça"
              message={`${overview.error || "A visão operacional não respondeu."} Nenhum valor foi presumido.`}
              onRetry={overview.reload}
            />
          ) : (
            <ProductWorkspace
              product={product}
              period={period}
              periodRange={periodRange}
              onPeriodChange={setPeriod}
              totvs={totvs.data}
              totvsLoading={totvs.loading}
              totvsError={totvs.error}
              traceability={traceability.data}
              traceabilityError={traceability.error}
              onBack={() => setSelectedProduct("")}
              onOpenLots={() => setNav("lotes")}
            />
          )
        ) : null}

        {nav === "inventario" ? (
          <OpeningInventory
            products={products.data ?? []}
            inventory={inventory.data}
            loading={inventory.loading || products.loading}
            error={inventory.error || products.error}
            onReload={inventory.reload}
            onUnsavedChange={setUnsavedInventory}
          />
        ) : null}

        {nav === "lotes" ? (
          <MaterialLotBoard
            materialLots={materialLots.data}
            loading={materialLots.loading}
            error={materialLots.error}
            onReload={materialLots.reload}
            products={products.data ?? []}
            onOpenProduct={selectProduct}
          />
        ) : null}

        {nav === "divergencias" ? (
          <DivergencesPanel
            divergences={divergences.data}
            loading={divergences.loading}
            error={divergences.error}
            onReload={divergences.reload}
            onOpenProduct={selectProduct}
          />
        ) : null}
      </main>

      <footer className={styles.footer}>
        <span>Flow Control · Central de Controle do Fluxo Produtivo</span>
        <span className="fc-mono">
          Período {periodRange.from} a {periodRange.to}
        </span>
      </footer>
    </>
  );
}
