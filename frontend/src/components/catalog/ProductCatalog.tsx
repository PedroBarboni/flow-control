import { useMemo } from "react";
import type { CatalogProduct, CatalogProductionRow } from "../../api/types";
import { filterProducts, groupProductsByFamily } from "../../lib/products";
import AsyncState from "../ui/AsyncState";
import ProductCard from "./ProductCard";
import styles from "./ProductCatalog.module.css";

interface ProductCatalogProps {
  products: CatalogProduct[];
  production: Map<string, CatalogProductionRow>;
  productionAvailable: boolean;
  productionMessage: string;
  search: string;
  onSelect: (productId: string) => void;
}

export default function ProductCatalog({
  products,
  production,
  productionAvailable,
  productionMessage,
  search,
  onSelect,
}: ProductCatalogProps) {
  const filtered = useMemo(() => filterProducts(products, search), [products, search]);
  const groups = useMemo(() => groupProductsByFamily(filtered), [filtered]);

  return (
    <section className={styles.catalog} aria-labelledby="catalog-title">
      <header className={styles.header}>
        <div>
          <span className="fc-label">Catálogo operacional</span>
          <h2 id="catalog-title">Peças controladas</h2>
        </div>
        <p className={styles.headerNote} aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "peça" : "peças"}
          {search.trim() ? ` para “${search.trim()}”` : " agrupadas por família"}
          {productionAvailable ? "" : ` · ${productionMessage}`}
        </p>
      </header>

      {groups.length ? (
        <div className={styles.families}>
          {groups.map((group) => (
            <section className={styles.family} key={group.id} aria-labelledby={`family-${group.id}`}>
              <header className={styles.familyHeader}>
                <h3 id={`family-${group.id}`}>{group.label}</h3>
                <span className={styles.familyCount}>
                  {group.products.length} {group.products.length === 1 ? "modelo" : "modelos"}
                </span>
              </header>
              <div className={styles.grid}>
                {group.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    production={production.get(product.id)}
                    productionAvailable={productionAvailable}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <AsyncState
          state="empty"
          compact
          title="Nenhuma peça encontrada"
          message={
            search.trim()
              ? "Revise o nome ou o código informado na busca."
              : "O catálogo não recebeu peças da fonte de dados."
          }
        />
      )}
    </section>
  );
}
