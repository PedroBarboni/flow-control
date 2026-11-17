import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../api/types";
import { filterProducts, groupProductsByFamily, materialDescription, officialCode } from "./products";

const make = (id: string, name: string, code: string, extra: Partial<CatalogProduct> = {}) =>
  ({ id, name, code, tracking_stages: [], totvs_destination_codes: [], ...extra }) as unknown as CatalogProduct;

const products = [
  make("placa-160", "Placa 160", "5119"),
  make("suporte-160", "Suporte 160", "5177"),
  make("conector-at", "Conector AT", "5205", { totvs_destination_codes: ["5205", "125205"] }),
  make("eixo-800", "Eixo 800", "115377"),
];

describe("catálogo de peças", () => {
  it("agrupa na ordem industrial fixa", () => {
    expect(groupProductsByFamily(products).map((group) => group.label)).toEqual([
      "Placa",
      "Suporte",
      "Eixo",
      "Conector",
    ]);
  });

  it("busca por nome, identificador e código oficial", () => {
    expect(filterProducts(products, "conector").map((item) => item.id)).toEqual(["conector-at"]);
    expect(filterProducts(products, "125205").map((item) => item.id)).toEqual(["conector-at"]);
    expect(filterProducts(products, "SUPORTE").map((item) => item.id)).toEqual(["suporte-160"]);
    expect(filterProducts(products, "")).toHaveLength(4);
  });

  it("usa o código do Blank quando a rota informa", () => {
    const withBlank = make("placa-400", "Placa 400", "5160", {
      tracking_stages: [
        { code: "5160", stage: "BLANK", process: "Corte", weight_kg: 0.8, machine: null, scrap_to_next_kg_per_piece: 0 },
      ],
    });
    expect(officialCode(withBlank)).toBe("5160");
    expect(officialCode(make("x", "X", "999"))).toBe("999");
  });

  it("descreve o material sem inventar disponibilidade", () => {
    expect(materialDescription(make("a", "A", "1", { rod_diameter_mm: "15.880", rod_material: "LATÃO 377 1/2 DURO" })))
      .toBe("Latão · Ø 15,880 mm");
    expect(materialDescription(make("b", "B", "2", { rod: "Matéria-prima ainda não mapeada" })))
      .toBe("Matéria-prima ainda não mapeada");
  });
});
