import { describe, expect, it } from "vitest";
import { decimalToString } from "./decimal";
import { buildRecommendations, rollingPeriods, type IntelligenceInput } from "./intelligence";
import { moneyFromMinor } from "./money";
import { summarizePriceHistory } from "./price-history";

const base = (over: Partial<IntelligenceInput> = {}): IntelligenceInput => {
  const { current, previous } = rollingPeriods("2026-11-22", 30);
  return {
    today: "2026-11-22",
    current,
    previous,
    currency: "EUR",
    finance: {
      current: [{ currency: "EUR", income: 100000n, expense: 50000n, count: 10 }],
      previous: [{ currency: "EUR", income: 100000n, expense: 50000n, count: 10 }],
      expenseByCategory: { current: [], previous: [] },
      expenses: [],
      open: [],
    },
    business: { lowStockCount: 0, projectsOverBudget: [], priceSeries: [] },
    ...over,
  };
};

describe("períodos móveis", () => {
  it("janela atual inclui hoje e a anterior tem o mesmo comprimento", () => {
    expect(rollingPeriods("2026-11-22", 7)).toEqual({
      current: { from: "2026-11-16", to: "2026-11-22" },
      previous: { from: "2026-11-09", to: "2026-11-15" },
    });
    expect(rollingPeriods("2026-03-01", 30).previous).toEqual({ from: "2026-01-01", to: "2026-01-30" });
  });
});

describe("recomendações", () => {
  it("sem nada a assinalar não inventa recomendações", () => {
    expect(buildRecommendations(base())).toEqual([]);
  });

  it("sem movimentos no período diz isso", () => {
    const r = buildRecommendations(base({ finance: { ...base().finance!, current: [] } }));
    expect(r.map((x) => x.kind)).toEqual(["no_movements"]);
  });

  it("resultado negativo e queda de receitas com os valores de suporte", () => {
    const r = buildRecommendations(
      base({
        finance: { ...base().finance!, current: [{ currency: "EUR", income: 70000n, expense: 90000n, count: 8 }] },
      }),
    );
    const neg = r.find((x) => x.kind === "negative_result")!;
    expect(neg.impact).toEqual(moneyFromMinor(20000n, "EUR"));
    expect(neg.severity).toBe("high");
    const drop = r.find((x) => x.kind === "income_drop")!;
    expect(drop.impact?.amountMinor).toBe(30000n);
    expect(decimalToString(drop.percent!)).toBe("-30");
    // As de severidade alta vêm primeiro.
    expect(r[0]!.kind).toBe("negative_result");
  });

  it("queda abaixo do limiar não é assinalada; moedas diferentes não se comparam", () => {
    const r = buildRecommendations(
      base({
        finance: {
          ...base().finance!,
          current: [
            { currency: "EUR", income: 85000n, expense: 10000n, count: 5 },
            { currency: "BRL", income: 1000n, expense: 0n, count: 1 },
          ],
          previous: [{ currency: "EUR", income: 100000n, expense: 10000n, count: 5 }],
        },
      }),
    );
    expect(r).toEqual([]);
  });

  it("subidas de despesa por categoria acima de 20 %, no máximo 3, ignorando categorias novas", () => {
    const r = buildRecommendations(
      base({
        finance: {
          ...base().finance!,
          expenseByCategory: {
            previous: [
              { key: "a", totalMinor: 10000n },
              { key: "b", totalMinor: 10000n },
              { key: "c", totalMinor: 10000n },
              { key: "d", totalMinor: 10000n },
              { key: "e", totalMinor: 10000n },
            ],
            current: [
              { key: "a", totalMinor: 15000n },
              { key: "b", totalMinor: 12000n },
              { key: "c", totalMinor: 11900n },
              { key: "d", totalMinor: 30000n },
              { key: "e", totalMinor: 13000n },
              { key: "novo", totalMinor: 99000n },
            ],
          },
        },
      }),
    );
    const inc = r.filter((x) => x.kind === "expense_increase");
    expect(inc.map((x) => x.subject)).toEqual(["d", "a", "e"]);
    expect(decimalToString(inc[0]!.percent!)).toBe("200.00");
  });

  it("pendentes: atrasados por moeda e a pagar nos próximos 7 dias", () => {
    const r = buildRecommendations(
      base({
        finance: {
          ...base().finance!,
          open: [
            { kind: "income", remainingMinor: 5000n, currency: "EUR", dueOn: "2026-11-01" },
            { kind: "income", remainingMinor: 2500n, currency: "EUR", dueOn: "2026-11-21" },
            { kind: "income", remainingMinor: 900n, currency: "BRL", dueOn: "2026-10-01" },
            { kind: "income", remainingMinor: 900n, currency: "EUR", dueOn: "2026-11-22" },
            { kind: "expense", remainingMinor: 3000n, currency: "EUR", dueOn: "2026-11-29" },
            { kind: "expense", remainingMinor: 3000n, currency: "EUR", dueOn: "2026-11-30" },
            { kind: "expense", remainingMinor: 1000n, currency: "EUR", dueOn: "2026-11-20" },
            { kind: "expense", remainingMinor: 0n, currency: "EUR", dueOn: "2026-11-01" },
            { kind: "expense", remainingMinor: 1000n, currency: "EUR", dueOn: null },
          ],
        },
      }),
    );
    const pick = (k: string) => r.filter((x) => x.kind === k).map((x) => [x.impact?.currency, x.impact?.amountMinor, x.count]);
    expect(pick("overdue_receivables")).toEqual([["EUR", 7500n, 2], ["BRL", 900n, 1]]);
    expect(pick("overdue_payables")).toEqual([["EUR", 1000n, 1]]);
    expect(pick("payables_due_soon")).toEqual([["EUR", 3000n, 1]]);
  });

  it("duplicados só no período, com o impacto das repetições e confiança média", () => {
    const ex = (id: string, day: string, amount = 4000n) => ({ id, description: "Internet", amountMinor: amount, currency: "EUR", occurredOn: day, contactId: null });
    const r = buildRecommendations(
      base({
        finance: {
          ...base().finance!,
          expenses: [ex("1", "2026-11-10"), ex("2", "2026-11-11"), ex("3", "2026-11-12"), ex("4", "2026-10-01"), ex("5", "2026-10-02")],
        },
      }),
    );
    const d = r.find((x) => x.kind === "possible_duplicates")!;
    expect([d.impact?.amountMinor, d.count, d.confidence]).toEqual([8000n, 3, "medium"]);
  });

  it("negócio: stock baixo, projetos acima do orçamento e subidas de preço do período", () => {
    const series = summarizePriceHistory([
      { id: "1", itemName: "Cimento", unit: "saco", unitPriceMinor: 500n, currency: "EUR", observedOn: "2026-09-01", createdAt: "a" },
      { id: "2", itemName: "cimento", unit: "saco", unitPriceMinor: 600n, currency: "EUR", observedOn: "2026-11-10", createdAt: "b" },
      { id: "3", itemName: "Areia", unit: null, unitPriceMinor: 1000n, currency: "EUR", observedOn: "2026-09-01", createdAt: "a" },
      { id: "4", itemName: "Areia", unit: null, unitPriceMinor: 1040n, currency: "EUR", observedOn: "2026-11-10", createdAt: "b" },
      { id: "5", itemName: "Tinta", unit: null, unitPriceMinor: 1000n, currency: "EUR", observedOn: "2026-09-01", createdAt: "a" },
      { id: "6", itemName: "Tinta", unit: null, unitPriceMinor: 2000n, currency: "EUR", observedOn: "2026-10-01", createdAt: "b" },
    ]);
    const r = buildRecommendations(
      base({
        finance: null,
        business: {
          lowStockCount: 2,
          projectsOverBudget: [{ id: "p1", name: "Obra", costVariance: moneyFromMinor(12000n, "EUR") }],
          priceSeries: series,
        },
      }),
    );
    expect(r.map((x) => x.kind)).toEqual(["project_over_budget", "low_stock", "supplier_price_increase"]);
    const price = r[2]!;
    expect([price.subject, price.impact?.amountMinor, decimalToString(price.percent!), price.confidence]).toEqual(["cimento (saco)", 100n, "20.0", "medium"]);
  });

  it("sem permissões (finanças e negócio a null) não devolve nada", () => {
    expect(buildRecommendations(base({ finance: null, business: null }))).toEqual([]);
  });
});
