import { describe, expect, it } from "vitest";
import { computeQuote } from "./quote";
import { quoteLinesFromServiceModel, SERVICE_MODEL_MARGIN_PERCENT } from "./service-models";

// Exemplo do pacote (Portugal): parede de drywall 2 faces c/ isolamento, 130 €/m² (sem IVA)
const drywall = {
  unit: "m²",
  composition: [
    { line: "Materiais de construção", kind: "material" as const, amountMinor: 7000n },
    { line: "Mão de obra (pedreiro)", kind: "labor" as const, amountMinor: 4500n },
    { line: "Mão de obra (servente)", kind: "labor" as const, amountMinor: 1000n },
    { line: "Aluguer de equipamento", kind: "equipment" as const, amountMinor: 300n },
    { line: "Deslocação / entulho", kind: "travel" as const, amountMinor: 200n },
  ],
};

const total = (quantity: string, taxRatePercent: string) => {
  const lines = quoteLinesFromServiceModel(drywall, quantity);
  return computeQuote({
    currency: "EUR",
    lines: lines.map((l) => ({ kind: l.kind, nature: l.nature, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
    marginPercent: SERVICE_MODEL_MARGIN_PERCENT,
    taxRatePercent,
  });
};

describe("orçamento a partir de um modelo com preço", () => {
  it("linhas = composição, na unidade do serviço e com a quantidade pedida", () => {
    const lines = quoteLinesFromServiceModel(drywall, "12.5");
    expect(lines.map((l) => [l.description, l.kind, l.quantity, l.unit, l.unitCostMinor])).toEqual([
      ["Materiais de construção", "material", "12.5", "m²", 7000n],
      ["Mão de obra (pedreiro)", "labor", "12.5", "m²", 4500n],
      ["Mão de obra (servente)", "labor", "12.5", "m²", 1000n],
      ["Aluguer de equipamento", "equipment", "12.5", "m²", 300n],
      ["Deslocação / entulho", "travel", "12.5", "m²", 200n],
    ]);
  });

  it("com margem 0, o total sem imposto é preço recomendado × quantidade (130 € × 12,5 m² = 1625 €)", () => {
    const r = total("12.5", "0");
    expect(r.priceBeforeTax.amountMinor).toBe(162500n);
    expect(r.total.amountMinor).toBe(162500n);
  });

  it("Portugal: somar IVA de 23 % quando o profissional escolhe (1625 € → 1998,75 €)", () => {
    const r = total("12.5", "23");
    expect(r.tax.amountMinor).toBe(37375n);
    expect(r.total.amountMinor).toBe(199875n);
  });
});
