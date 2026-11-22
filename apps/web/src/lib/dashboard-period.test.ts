import { describe, expect, it } from "vitest";
import { parseDashboardPeriod, periodTotals } from "./dashboard-period";

const series = Array.from({ length: 24 }, (_, i) => ({ income: String((i + 1) * 100), expense: String(i + 1) }));

describe("período do painel", () => {
  it("lê o parâmetro com valor por omissão", () => {
    expect(parseDashboardPeriod(undefined)).toBe("month");
    expect(parseDashboardPeriod("quarter")).toBe("quarter");
    expect(parseDashboardPeriod(["year", "month"])).toBe("year");
    expect(parseDashboardPeriod("x")).toBe("month");
  });

  it("mês atual contra o anterior", () => {
    expect(periodTotals(series, 1)).toEqual({ income: 2400n, expense: 24n, prevIncome: 2300n, prevExpense: 23n });
  });

  it("3 meses contra os 3 anteriores", () => {
    expect(periodTotals(series, 3)).toEqual({ income: 6900n, expense: 69n, prevIncome: 6000n, prevExpense: 60n });
  });

  it("12 meses contra os 12 anteriores", () => {
    const r = periodTotals(series, 12);
    expect(r).toEqual({ income: 22200n, expense: 222n, prevIncome: 7800n, prevExpense: 78n }); // 13..24 e 1..12
  });

  it("série curta: o período anterior soma só o que existe", () => {
    expect(periodTotals(series.slice(0, 2), 3)).toEqual({ income: 300n, expense: 3n, prevIncome: 0n, prevExpense: 0n });
  });

  it("valores grandes sem perder precisão", () => {
    const big = [{ income: "9007199254740993", expense: "0" }, { income: "9007199254740993", expense: "1" }];
    expect(periodTotals(big, 2).income).toBe(18014398509481986n);
  });
});
