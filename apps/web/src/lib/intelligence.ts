import "server-only";
import {
  buildRecommendations,
  registerCurrency,
  rollingPeriods,
  summarizePriceHistory,
  type IntelligencePeriod,
  type PeriodTotals,
  type Recommendation,
} from "@anen/financial-engine";
import type { Messages } from "@anen/i18n";
import type { AiDigestKind } from "@anen/types";
import { businessScope } from "@/lib/business";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import { projectFinancials } from "@/lib/projects";
import type { SessionContext } from "@/lib/session";

export const DIGEST_DAYS: Record<AiDigestKind, number> = { week: 7, month: 30 };

export function parseDigestKind(v: string | undefined | null): AiDigestKind {
  return v === "month" ? "month" : "week";
}

export interface IntelligenceData {
  kind: AiDigestKind;
  today: string;
  current: IntelligencePeriod;
  previous: IntelligencePeriod;
  currency: string;
  canFinance: boolean;
  canBusiness: boolean;
  totals: { current: PeriodTotals[]; previous: PeriodTotals[] };
  recommendations: Recommendation[];
  /** Nome legível de cada categoria (id → nome). */
  categoryNames: Map<string, string>;
  minorUnits: Map<string, number>;
}

/**
 * Recolhe os dados com a sessão da pessoa (RLS e permissões normais) e calcula as recomendações
 * no motor determinístico. Nada é estimado aqui.
 */
export async function loadIntelligence(session: SessionContext, m: Messages, kind: AiDigestKind): Promise<IntelligenceData> {
  const fin = financeScope(session);
  const biz = businessScope(session);
  const sb = session.supabase;
  const today = todayIn(fin.timezone);
  const { current, previous } = rollingPeriods(today, DIGEST_DAYS[kind]);

  const { data: currencies } = await sb.from("currencies").select("code, minor_unit");
  const minorUnits = new Map((currencies ?? []).map((c) => [c.code, c.minor_unit]));
  for (const [code, unit] of minorUnits) registerCurrency(code, unit);

  const report = async (p: IntelligencePeriod) => {
    const { data, error } = await sb.rpc("finance_report", { p_org: fin.orgId, p_from: p.from, p_to: p.to });
    if (error) throw new Error("finance_report");
    return data ?? [];
  };

  const [curRows, prevRows, expenses, open, categories] = fin.canRead
    ? await Promise.all([
        report(current),
        report(previous),
        sb
          .from("transactions")
          .select("id, description, amount_minor, currency_code, occurred_on, contact_id")
          .eq(fin.column, fin.value)
          .eq("kind", "expense")
          .gte("occurred_on", current.from)
          .lte("occurred_on", current.to)
          .limit(3000),
        sb
          .from("transactions")
          .select("kind, amount_minor, settled_minor, currency_code, due_on")
          .eq(fin.column, fin.value)
          .neq("payment_status", "paid")
          .not("due_on", "is", null)
          .limit(2000),
        sb.from("transaction_categories").select("id, key, name, is_system").or(`is_system.eq.true,${fin.column}.eq.${fin.value}`),
      ])
    : [[], [], { data: [] }, { data: [] }, { data: [] }];

  const totalsOf = (rows: typeof curRows): PeriodTotals[] =>
    rows
      .filter((r) => r.dimension === "total")
      .map((r) => ({ currency: r.currency_code, income: BigInt(r.income_total), expense: BigInt(r.expense_total), count: Number(r.count) }));
  const byCategory = (rows: typeof curRows) =>
    rows
      .filter((r) => r.dimension === "category" && r.currency_code === fin.defaultCurrency)
      .map((r) => ({ key: r.key, totalMinor: BigInt(r.expense_total) }))
      .filter((c) => c.totalMinor > 0n);

  let business: Parameters<typeof buildRecommendations>[0]["business"] = null;
  if (biz.canRead) {
    const [reorder, projects, prices] = await Promise.all([
      sb.rpc("stock_reorder_suggestions", { p_org: biz.orgId }),
      sb.from("projects").select("*").eq(biz.column, biz.value).in("status", ["planned", "active"]).limit(60),
      sb
        .from("supplier_prices")
        .select("id, item_name, unit, unit_price_minor, currency_code, observed_on, created_at")
        .eq(biz.column, biz.value)
        .order("observed_on", { ascending: false })
        .limit(3000),
    ]);
    const list = projects.data ?? [];
    const { data: ptx } =
      fin.canRead && list.length
        ? await sb
            .from("transactions")
            .select("project_id, kind, amount_minor, net_minor, settled_minor, cost_kind, currency_code")
            .in("project_id", list.map((p) => p.id))
        : { data: [] };
    business = {
      lowStockCount: (reorder.data ?? []).length,
      projectsOverBudget: list
        .map((p) => ({ p, f: projectFinancials(p, (ptx ?? []).filter((t) => t.project_id === p.id)) }))
        .filter(({ f }) => f.overBudget)
        .sort((a, b) => (a.f.costVariance.amountMinor > b.f.costVariance.amountMinor ? -1 : 1))
        .map(({ p, f }) => ({ id: p.id, name: p.name, costVariance: f.costVariance })),
      priceSeries: summarizePriceHistory(
        (prices.data ?? []).map((p) => ({
          id: p.id,
          itemName: p.item_name,
          unit: p.unit,
          unitPriceMinor: BigInt(String(p.unit_price_minor)),
          currency: p.currency_code,
          observedOn: p.observed_on,
          createdAt: p.created_at,
        })),
      ),
    };
  }

  const totals = { current: totalsOf(curRows), previous: totalsOf(prevRows) };
  const recommendations = buildRecommendations({
    today,
    current,
    previous,
    currency: fin.defaultCurrency,
    finance: fin.canRead
      ? {
          current: totals.current,
          previous: totals.previous,
          expenseByCategory: { current: byCategory(curRows), previous: byCategory(prevRows) },
          expenses: (expenses.data ?? []).map((t) => ({
            id: t.id,
            description: t.description,
            amountMinor: BigInt(t.amount_minor),
            currency: t.currency_code,
            occurredOn: t.occurred_on,
            contactId: t.contact_id,
          })),
          open: (open.data ?? []).map((t) => ({
            kind: t.kind,
            remainingMinor: BigInt(t.amount_minor) - BigInt(t.settled_minor),
            currency: t.currency_code,
            dueOn: t.due_on,
          })),
        }
      : null,
    business,
  });

  return {
    kind,
    today,
    current,
    previous,
    currency: fin.defaultCurrency,
    canFinance: fin.canRead,
    canBusiness: biz.canRead,
    totals,
    recommendations,
    categoryNames: new Map((categories.data ?? []).map((c) => [c.id, categoryLabel(m, c)])),
    minorUnits,
  };
}
