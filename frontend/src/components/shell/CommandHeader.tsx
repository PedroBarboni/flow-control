import { getIntegrationPresentation } from "../../lib/integrations";
import type { Integration } from "../../api/types";
import Icon from "../ui/Icon";
import styles from "./CommandHeader.module.css";

/** Destinos utilizáveis. Módulos incompletos não aparecem na navegação. */
export const DESTINATIONS = [
  { id: "central", label: "Central" },
  { id: "inventario", label: "Inventário" },
  { id: "lotes", label: "Lotes" },
  { id: "divergencias", label: "Divergências" },
] as const;

export type DestinationId = (typeof DESTINATIONS)[number]["id"];

interface CommandHeaderProps {
  activeNav: DestinationId;
  onNavigate: (destination: DestinationId) => void;
  search: string;
  onSearch: (value: string) => void;
  integrations: Integration[];
  integrationsUnavailable: boolean;
  /** Divergências abertas. `null` enquanto a varredura não respondeu — o
   * contador só aparece com número real, nunca zerado por suposição. */
  divergenceCount?: number | null;
}

export default function CommandHeader({
  activeNav,
  onNavigate,
  search,
  onSearch,
  integrations,
  integrationsUnavailable,
  divergenceCount = null,
}: CommandHeaderProps) {
  return (
    <header className={`${styles.header} fc-on-dark`}>
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => onNavigate("central")}
          aria-label="Ir para a Central de Controle"
        >
          <img src="/assets/logo-branca.png" alt="Flow Control" width="104" height="34" />
          <span className={styles.brandArea}>
            <small>Produção</small>
            <b>Central de Controle</b>
          </span>
        </button>

        <label className={styles.search}>
          <span className="fc-visually-hidden">Buscar peça por nome ou código</span>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar peça ou código"
            autoComplete="off"
          />
        </label>

        <div className={styles.sources} aria-label="Estado das fontes de dados">
          {integrationsUnavailable ? (
            <span className={`${styles.source} ${styles.sourceDanger}`}>
              <i aria-hidden="true" />
              Fontes · Indisponíveis
            </span>
          ) : integrations.length ? (
            integrations.map((integration) => {
              const presentation = getIntegrationPresentation(integration);
              return (
                <span
                  key={integration.name}
                  className={`${styles.source} ${styles[`source_${presentation.tone}`] ?? ""}`}
                  title={presentation.detail}
                >
                  <i aria-hidden="true" />
                  {integration.name} · {presentation.label}
                </span>
              );
            })
          ) : (
            <span className={styles.source}>
              <i aria-hidden="true" />
              Consultando fontes
            </span>
          )}
        </div>
      </div>

      <nav className={styles.nav} aria-label="Navegação principal">
        {DESTINATIONS.map((destination) => (
          <button
            key={destination.id}
            type="button"
            className={activeNav === destination.id ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
            aria-current={activeNav === destination.id ? "page" : undefined}
            onClick={() => onNavigate(destination.id)}
          >
            {destination.label}
            {destination.id === "divergencias" && divergenceCount !== null && divergenceCount > 0 ? (
              <span className={styles.navBadge} aria-label={`${divergenceCount} divergências abertas`}>
                {divergenceCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </header>
  );
}
