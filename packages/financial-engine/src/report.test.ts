import { describe, expect, it } from "vitest";
import { reportCurrencies, reportLines, reportPeriod, reportTotal, type ReportRow } from "./report";

describe("períodos dos relatórios", () => {
  it("mês, mês anterior (com mudança de ano), trimestre e anos", () => {
    expect(reportPeriod("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(reportPeriod("month", "2028-02-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(reportPeriod("previous_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(reportPeriod("quarter", "2026-11-21")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(reportPeriod("quarter", "2026-04-01")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(reportPeriod("year", "2026-11-21")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(reportPeriod("previous_year", "2026-11-21")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("personalizado: só datas válidas, por ordem e até 5 anos", () => {
    expect(reportPeriod("custom", "2026-11-21", { from: "2026-03-05", to: "2026-04-10" })).toEqual({ from: "2026-03-05", to: "2026-04-10" });
    const fallback = { from: "2026-11-01", to: "2026-11-30" };
    expect(reportPeriod("custom", "2026-11-21", { from: "2026-04-10", to: "2026-03-05" })).toEqual(fallback);
    expect(reportPeriod("custom", "2026-11-21", { from: "2026-02-30", to: "2026-03-05" })).toEqual(fallback);
    expect(reportPeriod("custom", "2026-11-21", { from: "2020-01-01", to: "2026-01-01" })).toEqual(fallback);
    expect(reportPeriod("custom", "2026-11-21", { from: null, to: "2026-01-01" })).toEqual(fallback);
  });
});

describe("linhas do relatório", () => {
  const row = (dimension: ReportRow["dimension"], key: string | null, currency: string, it: number, is: number, et: number, es: number): ReportRow => ({
    dimension,
    key,
    currency,
    incomeTotal: BigInt(it),
    incomeSettled: BigInt(is),
    expenseTotal: BigInt(et),
    expenseSettled: BigInt(es),
    count: 1,
  });
  const rows = [
    row("total", null, "EUR", 10000, 7000, 4000, 4000),
    row("total", null, "BRL", 500, 500, 0, 0),
    row("contact", "a", "EUR", 1000, 1000, 0, 0),
    row("contact", "b", "EUR", 9000, 6000, 0, 0),
    row("contact", null, "EUR", 0, 0, 4000, 4000),
    row("contact", "c", "BRL", 500, 500, 0, 0),
  ];

  it("resultado faturado e liquidado, por receber e por pagar", () => {
    expect(reportTotal(rows, "EUR")).toMatchObject({ resultTotal: 6000n, resultSettled: 3000n, receivable: 3000n, payable: 0n });
    expect(reportTotal(rows, "USD")).toMatchObject({ resultTotal: 0n, count: 0 });
  });

  it("ordena pela movimentação e não mistura moedas", () => {
    expect(reportLines(rows, "contact", "EUR").map((l) => l.key)).toEqual(["b", null, "a"]);
    expect(reportLines(rows, "contact", "BRL").map((l) => l.key)).toEqual(["c"]);
    expect(reportCurrencies(rows, "EUR")).toEqual(["EUR", "BRL"]);
    expect(reportCurrencies(rows, "BRL")).toEqual(["BRL", "EUR"]);
  });
});
