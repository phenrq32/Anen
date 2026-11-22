import { describe, expect, it } from "vitest";
import { financialHealth, healthBand } from "./health";

describe("saúde financeira", () => {
  it("sem base nenhuma devolve null (não inventa nota)", () => {
    expect(financialHealth({ income: 0n, expense: 0n, balance: 50000n, averageMonthlyExpense: 0n, overdueCount: 0 })).toBeNull();
  });

  it("nota máxima: poupa 20 %+, 6 meses de reserva e nada em atraso", () => {
    const h = financialHealth({ income: 100000n, expense: 70000n, balance: 600000n, averageMonthlyExpense: 100000n, overdueCount: 0 })!;
    expect(h.score).toBe(100);
    expect(h.band).toBe("excellent");
    expect(h.parts.savings).toEqual({ points: 40, max: 40, ratePercent: 30 });
    expect(h.parts.reserve.months).toBe(6);
  });

  it("partes proporcionais e penalização por atrasos", () => {
    const h = financialHealth({ income: 100000n, expense: 90000n, balance: 150000n, averageMonthlyExpense: 100000n, overdueCount: 2 })!;
    // 10 % → 20 pontos; 1,5 meses → 7 pontos (15 décimas / 2, truncado); 2 atrasos → 10.
    expect([h.parts.savings.points, h.parts.reserve.points, h.parts.onTime.points, h.score]).toEqual([20, 7, 10, 37]);
    expect(h.band).toBe("critical");
  });

  it("gastar mais do que recebe e saldo negativo dão 0 nessas partes", () => {
    const h = financialHealth({ income: 50000n, expense: 80000n, balance: -1000n, averageMonthlyExpense: 80000n, overdueCount: 5 })!;
    expect(h.score).toBe(0);
    expect(h.parts.savings.ratePercent).toBe(-60);
  });

  it("sem histórico usa a despesa do mês como base da reserva", () => {
    const h = financialHealth({ income: 0n, expense: 10000n, balance: 30000n, averageMonthlyExpense: 0n, overdueCount: 0 })!;
    expect(h.parts.reserve).toEqual({ points: 15, max: 30, months: 3 });
    expect(h.parts.savings.ratePercent).toBeNull();
  });

  it("faixas", () => {
    expect([80, 79, 60, 59, 40, 39].map(healthBand)).toEqual(["excellent", "good", "good", "attention", "attention", "critical"]);
  });
});
