import { describe, expect, it } from "vitest";
import { applyStockMovement, compareSupplierPrices, isBelowMinimum, StockError, stockValue, type SupplierPriceObservation } from "./stock";

describe("movimentos de stock", () => {
  const empty = { quantity: "0", averageCostMinor: 0n };

  it("custo médio ponderado nas entradas", () => {
    const a = applyStockMovement(empty, { kind: "in", quantity: "10", unitCostMinor: 200n });
    expect(a).toEqual({ quantity: "10.000", averageCostMinor: 200n, quantityChange: "10.000" });
    // (10 × 2,00 + 5 × 2,60) / 15 = 2,20
    const b = applyStockMovement(a, { kind: "in", quantity: "5", unitCostMinor: 260n });
    expect(b.averageCostMinor).toBe(220n);
    expect(b.quantity).toBe("15.000");
  });

  it("arredonda a meio para cima e aceita quantidades decimais", () => {
    // (1 × 1 + 1 × 2) / 2 = 1,5 → 2
    const a = applyStockMovement({ quantity: "1", averageCostMinor: 1n }, { kind: "in", quantity: "1", unitCostMinor: 2n });
    expect(a.averageCostMinor).toBe(2n);
    // (0,250 × 1000 + 0,750 × 1333) / 1 = 1249,75 → 1250
    const b = applyStockMovement({ quantity: "0.25", averageCostMinor: 1000n }, { kind: "in", quantity: "0.750", unitCostMinor: 1333n });
    expect(b).toMatchObject({ quantity: "1.000", averageCostMinor: 1250n });
  });

  it("saídas e perdas não mudam o custo médio nem deixam o saldo negativo", () => {
    const s = { quantity: "15", averageCostMinor: 220n };
    expect(applyStockMovement(s, { kind: "out", quantity: "4.5" })).toEqual({ quantity: "10.500", averageCostMinor: 220n, quantityChange: "-4.500" });
    expect(applyStockMovement(s, { kind: "loss", quantity: "15" }).quantity).toBe("0.000");
    expect(() => applyStockMovement(s, { kind: "out", quantity: "15.001" })).toThrow(StockError);
    expect(() => applyStockMovement(s, { kind: "out", quantity: "0" })).toThrow("quantity_invalid");
    expect(() => applyStockMovement(s, { kind: "in", quantity: "1" })).toThrow("amount_invalid");
  });

  it("a contagem fixa a quantidade e regista a diferença", () => {
    const s = { quantity: "15", averageCostMinor: 220n };
    expect(applyStockMovement(s, { kind: "count", quantity: "12" })).toEqual({ quantity: "12.000", averageCostMinor: 220n, quantityChange: "-3.000" });
    expect(applyStockMovement(s, { kind: "count", quantity: "0" }).quantity).toBe("0.000");
  });

  it("valor do stock e mínimo", () => {
    expect(stockValue("10.5", 220n, "EUR").amountMinor).toBe(2310n);
    expect(stockValue("0.333", 100n, "EUR").amountMinor).toBe(33n);
    expect(isBelowMinimum("2", "5")).toBe(true);
    expect(isBelowMinimum("5", "5")).toBe(false);
    expect(isBelowMinimum("0", "0")).toBe(false);
  });
});

describe("comparação entre fornecedores", () => {
  const obs = (id: string, supplierId: string, itemName: string, price: bigint, observedOn: string, unit: string | null = "kg", currency = "EUR"): SupplierPriceObservation => ({
    id,
    supplierId,
    supplierName: supplierId.toUpperCase(),
    itemName,
    unit,
    unitPriceMinor: price,
    currency,
    observedOn,
    createdAt: `${observedOn}T10:00:00Z`,
  });

  it("usa o preço mais recente de cada fornecedor e ordena do mais barato", () => {
    const result = compareSupplierPrices([
      obs("1", "a", "Farinha T65", 100n, "2026-10-01"),
      obs("2", "a", "farinha  t65", 130n, "2026-11-10"),
      obs("3", "b", "Farinha T65", 120n, "2026-11-01"),
      obs("4", "c", "Farinha T65", 120n, "2026-09-01"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.offers.map((o) => [o.supplierId, o.price.amountMinor, o.aboveCheapest.amountMinor])).toEqual([
      ["b", 120n, 0n],
      ["c", 120n, 0n],
      ["a", 130n, 10n],
    ]);
  });

  it("não compara unidades, moedas nem artigos com um só fornecedor", () => {
    const result = compareSupplierPrices([
      obs("1", "a", "Açúcar", 100n, "2026-11-01", "kg"),
      obs("2", "b", "Açúcar", 50n, "2026-11-01", "saco"),
      obs("3", "c", "Açúcar", 90n, "2026-11-01", "kg", "BRL"),
      obs("4", "a", "Sal", 30n, "2026-11-01"),
    ]);
    expect(result).toEqual([]);
  });
});
