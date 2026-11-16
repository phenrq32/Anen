import "server-only";
import { computeProjectFinancials, decimalToString, type Decimal, type ProjectFinancials, type QuoteLineKind } from "@anen/financial-engine";
import type { FinanceTransaction, Project, QuoteItem } from "@anen/types";

/** Previsto vs. real de um projeto a partir das linhas guardadas (sem cálculos fora do motor). */
export function projectFinancials(
  project: Pick<Project, "currency_code" | "planned_cost_minor" | "planned_revenue_minor">,
  transactions: Pick<FinanceTransaction, "kind" | "amount_minor" | "net_minor" | "settled_minor" | "cost_kind" | "currency_code">[],
  quoteItems: Pick<QuoteItem, "kind" | "total_cost_minor">[] = [],
): ProjectFinancials {
  const plannedByKind: Partial<Record<QuoteLineKind, bigint>> = {};
  for (const item of quoteItems) plannedByKind[item.kind] = (plannedByKind[item.kind] ?? 0n) + BigInt(item.total_cost_minor);
  return computeProjectFinancials(
    {
      currency: project.currency_code,
      plannedCostMinor: BigInt(project.planned_cost_minor),
      plannedRevenueMinor: BigInt(project.planned_revenue_minor),
      ...(quoteItems.length ? { plannedByKind } : {}),
    },
    transactions.map((t) => ({
      kind: t.kind,
      amountMinor: BigInt(t.amount_minor),
      netMinor: t.net_minor === null ? null : BigInt(t.net_minor),
      settledMinor: BigInt(t.settled_minor),
      costKind: t.cost_kind,
      currency: t.currency_code,
    })),
  );
}

/** Percentagem formatada por locale ("16,7 %"), ou null. */
export function formatPercent(value: Decimal | null, locale: string, digits = 1): string | null {
  if (!value) return null;
  const n = Number(decimalToString(value));
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n) + " %";
}
