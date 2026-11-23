import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, annualEquivalentMinor, balanceForecast, monthlyEquivalentMinor, occurrenceDate, upcomingOccurrences } from "./commitments";

describe("datas como o Postgres", () => {
  it("meses limitados ao fim do mês, sempre a partir do início (31/jan → 28/fev → 31/mar)", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("ocorrências semanais, mensais de 2 em 2 e anuais", () => {
    expect(occurrenceDate({ startOn: "2026-01-31", frequency: "monthly", intervalCount: 1 }, 1)).toBe("2026-02-28");
    expect(occurrenceDate({ startOn: "2026-01-05", frequency: "weekly", intervalCount: 2 }, 3)).toBe("2026-02-16");
    expect(occurrenceDate({ startOn: "2026-03-10", frequency: "monthly", intervalCount: 2 }, 2)).toBe("2026-07-10");
    expect(occurrenceDate({ startOn: "2024-02-29", frequency: "yearly", intervalCount: 1 }, 1)).toBe("2025-02-28");
  });

  it("só as que faltam gerar, dentro do intervalo e sem passar do fim", () => {
    const rule = { startOn: "2026-09-01", frequency: "monthly" as const, intervalCount: 1, occurrenceCount: 3, endOn: "2027-02-15" };
    expect(upcomingOccurrences(rule, "2026-11-01", "2027-12-31")).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(upcomingOccurrences({ ...rule, endOn: null }, "2027-01-01", "2027-03-31")).toEqual(["2027-01-01", "2027-02-01", "2027-03-01"]);
  });
});

describe("custo equivalente", () => {
  it("mensal e anual a partir de semanal, mensal e anual", () => {
    expect(monthlyEquivalentMinor(1299n, "monthly", 1)).toBe(1299n);
    expect(annualEquivalentMinor(1299n, "monthly", 1)).toBe(15588n);
    expect(monthlyEquivalentMinor(1000n, "weekly", 1)).toBe(4333n); // 1000 × 52 / 12 = 4333,33
    expect(annualEquivalentMinor(1000n, "weekly", 1)).toBe(52000n);
    expect(monthlyEquivalentMinor(11999n, "yearly", 1)).toBe(1000n); // 999,92 → 1000
    expect(monthlyEquivalentMinor(3000n, "monthly", 3)).toBe(1000n);
    expect(annualEquivalentMinor(3000n, "monthly", 3)).toBe(12000n);
  });
});

describe("previsão de saldo", () => {
  it("parte do saldo atual, soma os previstos por dia e indica o ponto mais baixo", () => {
    const f = balanceForecast(50000n, "2026-11-23", "2026-12-31", [
      { date: "2026-12-01", signedMinor: -80000n },
      { date: "2026-12-05", signedMinor: 150000n },
      { date: "2026-12-01", signedMinor: -5000n },
      { date: "2027-01-01", signedMinor: -1n }, // depois do fim: fora
    ]);
    expect(f.points).toEqual([
      { date: "2026-12-01", balanceMinor: -35000n },
      { date: "2026-12-05", balanceMinor: 115000n },
      { date: "2026-12-31", balanceMinor: 115000n },
    ]);
    expect(f.lowest).toEqual({ date: "2026-12-01", balanceMinor: -35000n });
    expect(f.endMinor).toBe(115000n);
  });

  it("valores em atraso contam hoje (continuam por pagar)", () => {
    const f = balanceForecast(10000n, "2026-11-23", "2026-11-30", [{ date: "2026-11-01", signedMinor: -3000n }]);
    expect(f.points[0]).toEqual({ date: "2026-11-23", balanceMinor: 7000n });
  });
});
