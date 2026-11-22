/** Período do painel: mês atual, últimos 3 meses ou últimos 12 meses (o mês atual conta sempre). */
export const DASHBOARD_PERIODS = ["month", "quarter", "year"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_MONTHS: Record<DashboardPeriod, number> = { month: 1, quarter: 3, year: 12 };

export function parseDashboardPeriod(v: string | string[] | undefined | null): DashboardPeriod {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "quarter" || s === "year" ? s : "month";
}

export interface MonthTotals {
  income: string;
  expense: string;
}

/**
 * Soma receitas e despesas dos últimos `months` pontos da série mensal (ordem cronológica, o último é o mês
 * atual) e do mesmo número de meses imediatamente antes. Valores em unidades mínimas (bigint), sem `number`.
 * Se a série não tiver meses suficientes para o período anterior, ele soma só o que existe.
 */
export function periodTotals(series: readonly MonthTotals[], months: number) {
  const n = Math.max(1, Math.floor(months));
  const sum = (rows: readonly MonthTotals[], key: keyof MonthTotals) => rows.reduce((acc, r) => acc + BigInt(r[key]), 0n);
  const end = series.length;
  const current = series.slice(Math.max(0, end - n), end);
  const previous = series.slice(Math.max(0, end - 2 * n), Math.max(0, end - n));
  return {
    income: sum(current, "income"),
    expense: sum(current, "expense"),
    prevIncome: sum(previous, "income"),
    prevExpense: sum(previous, "expense"),
  };
}
