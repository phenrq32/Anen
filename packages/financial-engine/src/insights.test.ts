import { describe, expect, it } from "vitest";
import { decimalToString } from "./decimal";
import { categoryChanges, findPossibleDuplicates, requiredRevenue, type ExpenseLike } from "./insights";

const e = (id: string, description: string, amount: number, day: string, contactId: string | null = null): ExpenseLike => ({
  id,
  description,
  amountMinor: BigInt(amount),
  currency: "EUR",
  occurredOn: day,
  contactId,
});

describe("despesas possivelmente duplicadas", () => {
  it("mesmo valor e descrição (sem acentos nem maiúsculas) a até 3 dias", () => {
    const groups = findPossibleDuplicates([
      e("1", "Eletricidade", 8000, "2026-11-01"),
      e("2", "eletricidade ", 8000, "2026-11-03"),
      e("3", "Eletricidade", 8000, "2026-11-10"),
      e("4", "Água", 8000, "2026-11-02"),
      e("5", "Seguro", 12000, "2026-11-05", "c1"),
      e("6", "Seguro auto", 12000, "2026-11-06", "c1"),
    ]);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([["1", "2"], ["5", "6"]]);
  });

  it("valores ou moedas diferentes não são duplicados", () => {
    expect(findPossibleDuplicates([e("1", "Renda", 50000, "2026-11-01"), e("2", "Renda", 50001, "2026-11-01")])).toEqual([]);
    expect(findPossibleDuplicates([e("1", "Renda", 500, "2026-11-01"), { ...e("2", "Renda", 500, "2026-11-01"), currency: "BRL" }])).toEqual([]);
  });
});

describe("variação por categoria", () => {
  it("ordena pelas maiores subidas e calcula a percentagem", () => {
    const changes = categoryChanges(
      [{ key: "mat", totalMinor: 10000n }, { key: "luz", totalMinor: 5000n }],
      [{ key: "mat", totalMinor: 13000n }, { key: "luz", totalMinor: 4000n }, { key: "novo", totalMinor: 2000n }],
      "EUR",
    );
    expect(changes.map((c) => [c.key, c.change.amountMinor, c.changePercent ? decimalToString(c.changePercent) : null])).toEqual([
      ["mat", 3000n, "30.00"],
      ["novo", 2000n, null],
      ["luz", -1000n, "-20.00"],
    ]);
  });
});

describe("receita necessária para um lucro", () => {
  it("média mensal da despesa + lucro pretendido, e o que falta", () => {
    const r = requiredRevenue({ targetProfitMinor: 300000n, totalExpenseMinor: 600000n, totalIncomeMinor: 750000n, months: 3, currency: "EUR" });
    expect(r.averageMonthlyExpense.amountMinor).toBe(200000n);
    expect(r.requiredMonthlyRevenue.amountMinor).toBe(500000n);
    expect(r.averageMonthlyIncome.amountMinor).toBe(250000n);
    expect(r.gap.amountMinor).toBe(250000n);
    expect(decimalToString(r.targetMargin!)).toBe("60.00");
  });

  it("sem falta quando a receita já chega; meses inválidos contam como 1", () => {
    const r = requiredRevenue({ targetProfitMinor: 100n, totalExpenseMinor: 100n, totalIncomeMinor: 1000n, months: 0, currency: "EUR" });
    expect(r.gap.amountMinor).toBe(0n);
    expect(r.requiredMonthlyRevenue.amountMinor).toBe(200n);
  });
});
