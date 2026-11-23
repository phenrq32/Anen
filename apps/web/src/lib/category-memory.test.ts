import { describe, expect, it } from "vitest";
import { buildCategoryMemory, descriptionKey, suggestCategory } from "./category-memory";

describe("memória de categorias", () => {
  it("normaliza a descrição (acentos, números, pontuação, maiúsculas)", () => {
    expect(descriptionKey("  Supermercado PINGO-DOCE 12/11 ")).toBe("supermercado pingo doce");
    expect(descriptionKey("Água")).toBe("agua");
    expect(descriptionKey("123")).toBe("");
  });

  it("a categoria mais recente para a mesma descrição e tipo é a sugerida", () => {
    const memory = buildCategoryMemory([
      { description: "Supermercado 21/11", kind: "expense", category_id: "food-new" },
      { description: "supermercado", kind: "expense", category_id: "food-old" },
      { description: "Supermercado", kind: "income", category_id: "refund" },
      { description: "Renda", kind: "expense", category_id: null },
    ]);
    expect(suggestCategory(memory, "expense", "SUPERMERCADO 3/12")).toBe("food-new");
    expect(suggestCategory(memory, "income", "supermercado")).toBe("refund");
    expect(suggestCategory(memory, "expense", "Renda")).toBeNull();
    expect(suggestCategory(memory, "expense", "x")).toBeNull();
  });
});
