import { describe, expect, it } from "vitest";
import { decimalToString } from "./decimal";
import { computeProjectFinancials, type ProjectMovement } from "./project";

const exp = (amount: bigint, extra: Partial<ProjectMovement> = {}): ProjectMovement => ({
  kind: "expense", amountMinor: amount, netMinor: null, settledMinor: amount, costKind: null, currency: "EUR", ...extra,
});
const inc = (amount: bigint, extra: Partial<ProjectMovement> = {}): ProjectMovement => ({ ...exp(amount, extra), kind: "income", ...extra });
const pct = (d: Parameters<typeof decimalToString>[0] | null) => (d ? decimalToString(d) : null);

describe("previsto vs. real de um projeto", () => {
  it("exemplo do prompt: materiais previstos 300 €, comprados 350 € → desvio de 50 €", () => {
    const r = computeProjectFinancials(
      { currency: "EUR", plannedCostMinor: 30000n, plannedRevenueMinor: 50000n, plannedByKind: { material: 30000n } },
      [exp(35000n, { costKind: "material" })],
    );
    expect(r.costVariance.amountMinor).toBe(5000n);
    expect(pct(r.costVariancePercent)).toBe("16.67");
    expect(r.overBudget).toBe(true);
    expect(r.byKind).toHaveLength(1);
    expect(r.byKind[0]!.variance.amountMinor).toBe(5000n);
    expect(pct(r.budgetUsedPercent)).toBe("116.67");
    expect(r.plannedProfit.amountMinor).toBe(20000n);
    expect(pct(r.plannedMarginPercent)).toBe("40.00");
  });

  it("lucro e margem reais usam valores sem imposto; recebido separado do faturado", () => {
    const r = computeProjectFinancials(
      { currency: "EUR", plannedCostMinor: 30000n, plannedRevenueMinor: 50000n },
      [
        // fatura de 615 € com IVA (500 € + 115 €), recebidos 307,50 €
        inc(61500n, { netMinor: 50000n, settledMinor: 30750n }),
        // material 246 € com IVA (200 € + 46 €), por pagar
        exp(24600n, { netMinor: 20000n, settledMinor: 0n, costKind: "material" }),
        exp(5000n, { costKind: "labor" }),
      ],
    );
    expect(r.actualCost.amountMinor).toBe(25000n);
    expect(r.invoicedRevenue.amountMinor).toBe(50000n);
    expect(r.receivedRevenue.amountMinor).toBe(25000n);
    expect(r.outstandingRevenue.amountMinor).toBe(25000n);
    expect(r.unpaidCost.amountMinor).toBe(24600n);
    expect(r.actualProfit.amountMinor).toBe(25000n);
    expect(pct(r.actualMarginPercent)).toBe("50.00");
    expect(r.overBudget).toBe(false);
    expect(r.costVariance.amountMinor).toBe(-5000n);
  });

  it("custos sem tipo aparecem como não classificados; sem previsto não há percentagem", () => {
    const r = computeProjectFinancials({ currency: "EUR", plannedCostMinor: 0n, plannedRevenueMinor: 0n }, [exp(1000n)]);
    expect(r.byKind.map((k) => k.kind)).toEqual(["unclassified"]);
    expect(r.costVariancePercent).toBeNull();
    expect(r.budgetUsedPercent).toBeNull();
    expect(r.overBudget).toBe(false);
    expect(r.actualMarginPercent).toBeNull();
  });

  it("nunca mistura moedas", () => {
    expect(() =>
      computeProjectFinancials({ currency: "EUR", plannedCostMinor: 0n, plannedRevenueMinor: 0n }, [exp(1000n, { currency: "BRL" })]),
    ).toThrow(/BRL/);
  });
});
