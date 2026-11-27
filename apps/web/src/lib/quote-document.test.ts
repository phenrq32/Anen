import { describe, expect, it } from "vitest";
import { buildQuoteDocument, quantityText, unitPriceMinor } from "./quote-document";

const line = (id: string, section: string | null, description: string, cost: bigint, quantity = "1", nature: "product" | "service" = "product") => ({
  id,
  section,
  description,
  nature,
  quantity,
  unit: "un",
  totalCostMinor: cost,
});

describe("documento do orçamento agrupado por serviço", () => {
  it("linhas seguidas com a mesma secção formam um grupo com subtotal; sem secção fica à parte", () => {
    const doc = buildQuoteDocument({
      currency: "EUR",
      priceBeforeTaxMinor: 100000n,
      discountMinor: 0n,
      lines: [
        line("a", "Pintura de T2 completo", "Tinta", 30000n, "2"),
        line("b", "Pintura de T2 completo", "Fita, lixas", 10000n, "2"),
        line("c", "Pintura de portas", "Esmalte", 10000n),
        line("d", null, "Deslocação", 0n, "1", "service"),
      ],
    });
    expect(doc.groups.map((g) => [g.section, g.lines.map((l) => l.description), g.subtotalMinor])).toEqual([
      ["Pintura de T2 completo", ["Tinta", "Fita, lixas"], 80000n],
      ["Pintura de portas", ["Esmalte"], 20000n],
      [null, ["Deslocação"], 0n],
    ]);
    // Preço repartido na proporção do custo, sem perder cêntimos
    const total = doc.groups.reduce((s, g) => s + g.subtotalMinor, 0n);
    expect(total).toBe(100000n);
    expect(doc.groups[0]!.lines[0]!.unitPriceMinor).toBe(30000n); // 600,00 € ÷ 2
    expect(doc.productsMinor + doc.servicesMinor).toBe(100000n);
  });

  it("com desconto, as linhas mostram o preço antes do desconto", () => {
    const doc = buildQuoteDocument({ currency: "EUR", priceBeforeTaxMinor: 9000n, discountMinor: 1000n, lines: [line("a", null, "X", 500n)] });
    expect(doc.subtotalMinor).toBe(10000n);
    expect(doc.groups[0]!.lines[0]!.amountMinor).toBe(10000n);
  });

  it("preço unitário sem vírgula flutuante e quantidade legível", () => {
    expect(unitPriceMinor(56250n, "12.5")).toBe(4500n);
    expect(unitPriceMinor(1000n, "3")).toBe(333n);
    expect(unitPriceMinor(500n, "0")).toBe(0n);
    expect(quantityText("12.500")).toBe("12.5");
    expect(quantityText(3)).toBe("3");
    expect(quantityText("2.000")).toBe("2");
  });
});
