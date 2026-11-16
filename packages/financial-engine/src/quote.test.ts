import { describe, expect, it } from "vitest";
import { computeQuote, computeRecipe, decimalToString, ingredientCost, toDecimalString } from "./index";

const s = toDecimalString;

describe("computeQuote", () => {
  it("pintura de apartamento: materiais, mão de obra, deslocação, indiretos, margem e IVA", () => {
    const q = computeQuote({
      currency: "EUR",
      lines: [
        { kind: "material", quantity: "18", unitCostMinor: 2490n }, // 18 L tinta × 24,90
        { kind: "material", quantity: "1", unitCostMinor: 4500n }, // fita, lixas
        { kind: "labor", quantity: "32.5", unitCostMinor: 1800n }, // 32,5 h × 18,00
        { kind: "travel", quantity: "68", unitCostMinor: 36n }, // 68 km × 0,36
        { kind: "overhead", quantity: "1", unitCostMinor: 3000n },
      ],
      marginPercent: "25",
      taxRatePercent: "23",
    });
    expect(s(q.costByKind.material)).toBe("493.20");
    expect(s(q.costByKind.labor)).toBe("585.00");
    expect(s(q.costByKind.travel)).toBe("24.48");
    expect(s(q.directCost)).toBe("1102.68");
    expect(s(q.totalCost)).toBe("1132.68");
    expect(s(q.priceBeforeTax)).toBe("1510.24"); // 1132,68 / 0,75
    expect(s(q.profit)).toBe("377.56");
    expect(s(q.tax)).toBe("347.36");
    expect(s(q.total)).toBe("1857.60");
    expect(decimalToString(q.effectiveMarginPercent!)).toBe("25.00");
    expect(decimalToString(q.effectiveMarkupPercent!)).toBe("33.33");
  });

  it("sem margem e sem imposto o total é o custo", () => {
    const q = computeQuote({ currency: "BRL", lines: [{ kind: "labor", quantity: "3", unitCostMinor: 5000n }], marginPercent: "0", taxRatePercent: "0" });
    expect(s(q.total)).toBe("150.00");
  });

  it("orçamento vazio dá zero e margem indefinida", () => {
    const q = computeQuote({ currency: "EUR", lines: [], marginPercent: "20", taxRatePercent: "23" });
    expect(s(q.total)).toBe("0.00");
    expect(q.effectiveMarginPercent).toBeNull();
  });

  it("rejeita margem ≥ 100, imposto negativo e quantidades negativas", () => {
    expect(() => computeQuote({ currency: "EUR", lines: [], marginPercent: "100", taxRatePercent: "0" })).toThrow();
    expect(() => computeQuote({ currency: "EUR", lines: [], marginPercent: "10", taxRatePercent: "-1" })).toThrow();
    expect(() => computeQuote({ currency: "EUR", lines: [{ kind: "material", quantity: "-1", unitCostMinor: 100n }], marginPercent: "10", taxRatePercent: "0" })).toThrow();
  });
});

describe("computeRecipe", () => {
  it("custo de ingrediente com desperdício", () => {
    // batata: 5 kg a 4,50 €; usa 1,2 kg com 20 % de perda → precisa de 1,5 kg → 1,35 €
    expect(s(ingredientCost({ quantity: "1.2", packageQuantity: "5", packagePriceMinor: 450n, wastePercent: "20" }, "EUR"))).toBe("1.35");
    // azeite: 750 ml a 7,99 €; usa 40 ml sem perda → 0,43 €
    expect(s(ingredientCost({ quantity: "40", packageQuantity: "750", packagePriceMinor: 799n, wastePercent: "0" }, "EUR"))).toBe("0.43");
  });

  it("bacalhau à brás para 4 doses: custo por dose, food cost e preços", () => {
    const r = computeRecipe({
      currency: "EUR",
      portions: "4",
      ingredients: [
        { quantity: "600", packageQuantity: "1000", packagePriceMinor: 1590n, wastePercent: "15" }, // bacalhau
        { quantity: "1.2", packageQuantity: "5", packagePriceMinor: 450n, wastePercent: "20" }, // batata
        { quantity: "6", packageQuantity: "12", packagePriceMinor: 360n, wastePercent: "0" }, // ovos
        { quantity: "40", packageQuantity: "750", packagePriceMinor: 799n, wastePercent: "0" }, // azeite
      ],
      extraCostsMinor: [120n, 600n, 80n], // energia, mão de obra, embalagem
      targetFoodCostPercent: "30",
      minimumMarginPercent: "0",
      taxRatePercent: "13",
    });
    expect(s(r.ingredientCosts[0]!)).toBe("11.22");
    expect(s(r.ingredientsTotal)).toBe("14.80");
    expect(s(r.totalCost)).toBe("22.80");
    expect(s(r.costPerPortion)).toBe("5.70");
    expect(s(r.ingredientCostPerPortion)).toBe("3.70");
    expect(s(r.minimumPrice)).toBe("5.70");
    expect(s(r.recommendedPrice)).toBe("12.34"); // 3,70 / 0,30 arredondado para cima
    expect(s(r.recommendedPriceWithTax)).toBe("13.94");
    expect(decimalToString(r.foodCostPercent!)).toBe("29.98");
  });

  it("o preço recomendado nunca fica abaixo do mínimo", () => {
    const r = computeRecipe({
      currency: "BRL",
      portions: "1",
      ingredients: [{ quantity: "1", packageQuantity: "1", packagePriceMinor: 100n, wastePercent: "0" }],
      extraCostsMinor: [5000n],
      targetFoodCostPercent: "35",
      minimumMarginPercent: "10",
      taxRatePercent: "0",
    });
    expect(s(r.minimumPrice)).toBe("56.67");
    expect(s(r.recommendedPrice)).toBe("56.67");
  });
});
