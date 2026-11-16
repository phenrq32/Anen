import { describe, expect, it } from "vitest";
import { decimalToString } from "./decimal";
import { computeMonthlyPlan } from "./monthly-plan";

const plan = (salary: bigint, fixed: bigint[], reserve = 0n) =>
  computeMonthlyPlan({ currency: "EUR", salaryMinor: salary, fixedExpensesMinor: fixed, emergencyReserveMinor: reserve });

describe("plano do mês", () => {
  it("salário 1500 €, fixas 1000 €, sem reserva: 80 % da sobra para a reserva", () => {
    const p = plan(150000n, [65000n, 20000n, 15000n]);
    expect(p.status).toBe("surplus");
    expect(p.fixedTotal.amountMinor).toBe(100000n);
    expect(p.surplus.amountMinor).toBe(50000n);
    expect(decimalToString(p.fixedPercentOfSalary!)).toBe("66.67");
    expect(p.fixedAboveHalf).toBe(true);
    expect(p.surplusSize).toBe("large");
    expect(p.reserve.target.amountMinor).toBe(600000n);
    expect(p.allocation.reserve.amountMinor).toBe(40000n);
    expect(p.allocation.longTerm.amountMinor).toBe(10000n);
    expect(p.reserve.monthsToTarget).toBe(15);
    expect(p.projection.months12.amountMinor).toBe(600000n);
  });

  it("reserva entre 3 e 6 meses: 50 %; nunca mais do que falta", () => {
    const half = plan(200000n, [100000n], 400000n);
    expect(decimalToString(half.reserve.monthsCovered!)).toBe("4.0");
    expect(half.allocation.reserve.amountMinor).toBe(50000n);
    const almost = plan(200000n, [100000n], 590000n);
    expect(almost.allocation.reserve.amountMinor).toBe(10000n);
    expect(almost.allocation.longTerm.amountMinor).toBe(90000n);
    expect(almost.reserve.monthsToTarget).toBe(1);
  });

  it("reserva completa: tudo para o longo prazo", () => {
    const p = plan(200000n, [100000n], 600000n);
    expect(p.reserve.complete).toBe(true);
    expect(p.allocation.reserve.amountMinor).toBe(0n);
    expect(p.allocation.longTerm.amountMinor).toBe(100000n);
    expect(p.reserve.monthsToTarget).toBeNull();
  });

  it("sobra pequena (< 5 % do salário) também recebe orientação", () => {
    const p = plan(100000n, [97000n]);
    expect(p.surplusSize).toBe("small");
    expect(p.allocation.reserve.amountMinor + p.allocation.longTerm.amountMinor).toBe(3000n);
  });

  it("défice e equilíbrio não sugerem investimentos", () => {
    const deficit = plan(100000n, [80000n, 30000n]);
    expect(deficit.status).toBe("deficit");
    expect(deficit.surplus.amountMinor).toBe(-10000n);
    expect(deficit.allocation.reserve.amountMinor + deficit.allocation.longTerm.amountMinor).toBe(0n);
    expect(deficit.projection.months12.amountMinor).toBe(0n);
    expect(plan(100000n, [100000n]).status).toBe("balanced");
  });

  it("sem despesas fixas, a reserva alvo é de 3 salários; sem salário não há percentagens", () => {
    const p = plan(120000n, []);
    expect(p.reserve.target.amountMinor).toBe(360000n);
    expect(p.reserve.monthsCovered).toBeNull();
    expect(p.allocation.reserve.amountMinor).toBe(96000n);
    const empty = plan(0n, [10000n]);
    expect(empty.fixedPercentOfSalary).toBeNull();
    expect(empty.status).toBe("deficit");
  });

  it("rejeita valores negativos", () => {
    expect(() => plan(-1n, [])).toThrow();
  });
});
