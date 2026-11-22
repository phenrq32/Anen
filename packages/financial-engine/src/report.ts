/**
 * Relatórios: períodos e leitura das linhas agregadas pelo servidor (public.finance_report).
 * Faturado = valor total dos movimentos com data no período; liquidado = o que já foi recebido ou pago.
 * Determinístico, sem ponto flutuante; moedas nunca se misturam.
 */
export const REPORT_PRESETS = ["month", "previous_month", "quarter", "year", "previous_year", "custom"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface ReportPeriod {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string | null | undefined): v is string {
  if (!v || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** Período a partir de um modelo e da data de hoje (AAAA-MM-DD). "custom" usa from/to se forem válidos (máx. 5 anos). */
export function reportPeriod(preset: ReportPreset, today: string, custom?: { from?: string | null; to?: string | null }): ReportPeriod {
  const [y, m] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "previous_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, q, 1), to: iso(y, q + 2, lastDay(y, q + 2)) };
    }
    case "year":
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    case "previous_year":
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) };
    case "custom": {
      if (validDate(custom?.from) && validDate(custom?.to) && custom.from <= custom.to) {
        const limit = iso(Number(custom.from.slice(0, 4)) + 5, Number(custom.from.slice(5, 7)), 1);
        if (custom.to < limit) return { from: custom.from, to: custom.to };
      }
      return reportPeriod("month", today);
    }
    default:
      return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
  }
}

export type ReportDimension = "total" | "category" | "contact" | "project" | "cost_center";

export interface ReportRow {
  dimension: ReportDimension;
  key: string | null;
  currency: string;
  incomeTotal: bigint;
  incomeSettled: bigint;
  expenseTotal: bigint;
  expenseSettled: bigint;
  count: number;
}

export interface ReportLine extends ReportRow {
  /** Receita − despesa, faturado. */
  resultTotal: bigint;
  /** Receita − despesa, liquidado (caixa). */
  resultSettled: bigint;
  /** Por receber (receita faturada − recebida). */
  receivable: bigint;
  /** Por pagar (despesa faturada − paga). */
  payable: bigint;
}

function enrich(r: ReportRow): ReportLine {
  return {
    ...r,
    resultTotal: r.incomeTotal - r.expenseTotal,
    resultSettled: r.incomeSettled - r.expenseSettled,
    receivable: r.incomeTotal - r.incomeSettled,
    payable: r.expenseTotal - r.expenseSettled,
  };
}

/** Linhas de uma dimensão numa moeda, da maior movimentação (receita + despesa faturadas) para a menor. */
export function reportLines(rows: readonly ReportRow[], dimension: ReportDimension, currency: string): ReportLine[] {
  return rows
    .filter((r) => r.dimension === dimension && r.currency === currency)
    .map(enrich)
    .sort((a, b) => {
      const va = a.incomeTotal + a.expenseTotal;
      const vb = b.incomeTotal + b.expenseTotal;
      return va === vb ? 0 : va > vb ? -1 : 1;
    });
}

/** Total do período numa moeda (zeros quando não há movimentos). */
export function reportTotal(rows: readonly ReportRow[], currency: string): ReportLine {
  const row = rows.find((r) => r.dimension === "total" && r.currency === currency);
  return enrich(
    row ?? { dimension: "total", key: null, currency, incomeTotal: 0n, incomeSettled: 0n, expenseTotal: 0n, expenseSettled: 0n, count: 0 },
  );
}

/** Moedas presentes no relatório, a preferida primeiro. */
export function reportCurrencies(rows: readonly ReportRow[], preferred: string): string[] {
  const set = new Set(rows.filter((r) => r.dimension === "total").map((r) => r.currency));
  return [...set].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b)));
}
