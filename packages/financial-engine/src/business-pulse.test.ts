import { describe, expect, it } from "vitest";
import { businessPulse } from "./business-pulse";

describe("Hoje da empresa (§6.1)", () => {
  const base = { cashMinor: 500000n, incomeMinor: 300000n, expenseMinor: 210000n, today: "2026-11-27", horizon: "2026-12-27" };

  it("separa saldo registado, resultado do período e margem", () => {
    const p = businessPulse({ ...base, open: [] });
    expect([p.cashMinor, p.resultMinor, p.marginBasisPoints]).toEqual([500000n, 90000n, 3000n]); // 30 %
    expect(p.forecastMinor).toBe(500000n);
  });

  it("previsto: só entra no saldo previsto o que vence até ao horizonte (e o já vencido)", () => {
    const p = businessPulse({
      ...base,
      open: [
        { kind: "income", remainingMinor: 100000n, dueOn: "2026-12-10" },
        { kind: "income", remainingMinor: 40000n, dueOn: "2026-11-01" }, // vencido
        { kind: "income", remainingMinor: 70000n, dueOn: "2027-02-01" }, // fora do horizonte
        { kind: "income", remainingMinor: 5000n, dueOn: null }, // sem data
        { kind: "expense", remainingMinor: 80000n, dueOn: "2026-12-27" },
        { kind: "expense", remainingMinor: 0n, dueOn: "2026-12-01" }, // já liquidado
      ],
    });
    expect([p.receivableMinor, p.receivableDueMinor, p.overdueReceivables]).toEqual([215000n, 140000n, 1]);
    expect([p.payableMinor, p.payableDueMinor, p.overduePayables]).toEqual([80000n, 80000n, 0]);
    expect(p.forecastMinor).toBe(500000n + 140000n - 80000n);
  });

  it("sem receitas não há margem; prejuízo dá margem negativa", () => {
    expect(businessPulse({ ...base, incomeMinor: 0n, open: [] }).marginBasisPoints).toBeNull();
    const loss = businessPulse({ ...base, incomeMinor: 100000n, expenseMinor: 133333n, open: [] });
    expect(loss.resultMinor).toBe(-33333n);
    expect(loss.marginBasisPoints).toBe(-3333n);
  });
});
