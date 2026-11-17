/** Agrupamento e busca do catálogo por família industrial. */

import type { CatalogProduct, TrackingStage } from "../api/types";

interface FamilyDefinition {
  id: string;
  label: string;
  matcher: RegExp;
}

const FAMILY_DEFINITIONS: FamilyDefinition[] = [
  { id: "placa", label: "Placa", matcher: /\bplaca\b/ },
  { id: "suporte", label: "Suporte", matcher: /\bsuporte\b/ },
  { id: "eixo", label: "Eixo", matcher: /\beixo\b/ },
  {
    id: "conector",
    label: "Conector",
    matcher: /\bconector\b/,
  },
  { id: "bucha", label: "Bucha", matcher: /\bbucha\b/ },
  { id: "pino", label: "Pino", matcher: /\bpino\b/ },
];

const FAMILY_ORDER = FAMILY_DEFINITIONS.map(({ id, label }) => ({ id, label }));

export interface ProductFamilyGroup {
  id: string;
  label: string;
  products: CatalogProduct[];
}

function normalizeForSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function productSearchText(product: Partial<CatalogProduct> | undefined): string {
  const values: unknown[] = [
    product?.id,
    product?.name,
    product?.code,
    (product as { database_name?: string })?.database_name,
    product?.totvs_destination_codes,
    product?.totvs_destination_code_stages && Object.keys(product.totvs_destination_code_stages),
  ];
  return values
    .flat(Infinity as 1)
    .filter(
      (value): value is string | number =>
        typeof value === "string" || (typeof value === "number" && Number.isFinite(value)),
    )
    .map(String)
    .join(" ");
}

function familyForProduct(product: CatalogProduct): FamilyDefinition | null {
  const text = normalizeForSearch(productSearchText(product));
  return FAMILY_DEFINITIONS.find(({ matcher }) => matcher.test(text)) || null;
}

/** Agrupa na ordem industrial fixa, preservando a ordem de entrada. */
export function groupProductsByFamily(products: CatalogProduct[] = []): ProductFamilyGroup[] {
  const groups = new Map<string, ProductFamilyGroup>(
    FAMILY_ORDER.map(({ id, label }) => [id, { id, label, products: [] }]),
  );
  const otherProducts: CatalogProduct[] = [];

  for (const product of Array.isArray(products) ? products : []) {
    const family = familyForProduct(product);
    if (family) groups.get(family.id)?.products.push(product);
    else otherProducts.push(product);
  }

  const result = FAMILY_ORDER.map(({ id }) => groups.get(id)!).filter(
    (group) => group.products.length > 0,
  );
  if (otherProducts.length > 0) result.push({ id: "outros", label: "Outros", products: otherProducts });
  return result;
}

/** Filtra por nome, identificador ou qualquer código conhecido da peça. */
export function filterProducts(products: CatalogProduct[] = [], query = ""): CatalogProduct[] {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return Array.isArray(products) ? products : [];
  return (Array.isArray(products) ? products : []).filter((product) =>
    normalizeForSearch(productSearchText(product)).includes(normalizedQuery),
  );
}

/** Identificação técnica compartilhada pelo catálogo e pelo controle da peça. */
export interface ProductIdentity {
  code?: string;
  tracking_stages?: TrackingStage[];
  rod?: string;
  rod_diameter_mm?: string | null;
  rod_material?: string | null;
  rod_available?: boolean | null;
}

/** Código oficial exibido no card: o código do Blank quando existir. */
export function officialCode(product: ProductIdentity | undefined): string | null {
  const blank = product?.tracking_stages?.find((stage) =>
    String(stage.stage || "").toUpperCase().includes("BLANK"),
  );
  return blank?.code || product?.code || null;
}

/** Descrição curta do vergalhão para o contexto da peça. */
export function materialDescription(product: ProductIdentity | undefined): string {
  if (product?.rod_diameter_mm) {
    const rawMaterial = String(product.rod_material || "");
    const material = rawMaterial.includes("COBRE")
      ? "Cobre"
      : rawMaterial.includes("LATÃO") || rawMaterial.includes("LATAO")
        ? "Latão"
        : rawMaterial || "Material não informado";
    const diameter = String(product.rod_diameter_mm).replace(".", ",");
    const availability = product.rod_available === false ? " · indisponível" : "";
    return `${material} · Ø ${diameter} mm${availability}`;
  }
  return product?.rod || "Vergalhão não mapeado";
}
