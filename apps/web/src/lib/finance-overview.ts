import "server-only";
import type { Messages } from "@anen/i18n";
import type { Budget, FinanceTransaction, Locale, SavingsGoal } from "@anen/types";
import type { CategorySlice, MonthlyPoint } from "@/components/charts";
import {
  categoryLabel,
  loadFinanceBasics,
  materializeDue,
  monthBounds,
  shiftMonth,
  todayIn,
  type FinanceBasics,
  type FinanceScope,
} from "@/lib/finance";
import type { ServerClient } from "@/lib/supabase/server";

export interface FinanceOverview {
  basics: FinanceBasics;
  month: string;
  today: string;
  currency: string;
  minorUnit: number;
  otherCurrencies: string[];
  balance: bigint;
  income: bigint;
  expense: bigint;
  prevIncome: bigint;
  prevExpense: bigint;
  monthly: MonthlyPoint[];
  byCategory: CategorySlice[];
  recent: FinanceTransaction[];
  budgets: Array<Budget & { spent: bigint; label: string }>;
  goals: SavingsGoal[];
}

export async function loadFinanceOverview(
  supabase: ServerClient,
  scope: FinanceScope,
  m: Messages,
  locale: Locale,
): Promise<FinanceOverview> {
  await materializeDue(supabase, scope);
  const today = todayIn(scope.timezone);
  const month = today.slice(0, 7);
  const firstMonth = shiftMonth(month, -11);
  const { from: monthFrom, to: monthTo } = monthBounds(month);

  const [basics, monthlyRes, catRes, recentRes, budgetsRes, goalsRes] = await Promise.all([
    loadFinanceBasics(supabase, scope),
    supabase.rpc("finance_monthly", { p_org: scope.orgId, p_from: `${firstMonth}-01`, p_to: monthTo }),
    supabase.rpc("finance_by_category", { p_org: scope.orgId, p_from: monthFrom, p_to: monthTo, p_kind: "expense" }),
    supabase.from("transactions").select("*").eq(scope.column, scope.value).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(8),
    supabase.from("budgets").select("*").eq(scope.column, scope.value).eq("period_start", monthFrom),
    supabase.from("savings_goals").select("*").eq(scope.column, scope.value).order("created_at"),
  ]);
  if (monthlyRes.error || catRes.error || recentRes.error || budgetsRes.error || goalsRes.error) {
    throw new Error("Falha ao carregar o resumo financeiro");
  }
  const monthlyRows = monthlyRes.data ?? [];

  // Moeda apresentada: a do âmbito, ou a que tiver mais atividade se a do âmbito não tiver movimentos.
  const activity = new Map<string, number>();
  for (const r of monthlyRows) activity.set(r.currency_code, (activity.get(r.currency_code) ?? 0) + 1);
  for (const a of basics.accounts) activity.set(a.currency_code, (activity.get(a.currency_code) ?? 0) + 0.5);
  const currency = activity.has(scope.defaultCurrency) || activity.size === 0
    ? scope.defaultCurrency
    : [...activity.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const otherCurrencies = [...activity.keys()].filter((c) => c !== currency).sort();
  const minorUnit = basics.minorUnits.get(currency) ?? 2;

  const monthName = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const monthFull = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const monthly: MonthlyPoint[] = Array.from({ length: 12 }, (_, i) => {
    const key = shiftMonth(firstMonth, i);
    const row = monthlyRows.find((r) => r.currency_code === currency && r.month.startsWith(key));
    const date = new Date(`${key}-01T00:00:00Z`);
    return {
      month: key,
      label: monthName.format(date).replace(".", ""),
      fullLabel: monthFull.format(date),
      income: String(row?.income ?? 0),
      expense: String(row?.expense ?? 0),
    };
  });
  const current = monthly[11]!;
  const previous = monthly[10]!;

  const categories = new Map(basics.categories.map((c) => [c.id, c]));
  const catRows = (catRes.data ?? []).filter((r) => r.currency_code === currency);
  const top = catRows.slice(0, 6).map<CategorySlice>((r) => ({
    id: r.category_id ?? "none",
    label: categoryLabel(m, r.category_id ? categories.get(r.category_id) : undefined),
    amount: String(r.total),
    count: Number(r.count),
  }));
  const rest = catRows.slice(6);
  if (rest.length) {
    top.push({
      id: "others",
      label: m.finance.chart.others,
      amount: String(rest.reduce((acc, r) => acc + BigInt(r.total), 0n)),
      count: rest.reduce((acc, r) => acc + Number(r.count), 0),
    });
  }

  const spentByCategory = new Map((catRes.data ?? []).map((r) => [`${r.category_id}:${r.currency_code}`, BigInt(r.total)]));
  const budgets = (budgetsRes.data ?? []).map((b) => ({
    ...b,
    spent: spentByCategory.get(`${b.category_id}:${b.currency_code}`) ?? 0n,
    label: categoryLabel(m, categories.get(b.category_id)),
  }));

  const balance = basics.accounts
    .filter((a) => a.currency_code === currency && !a.archived_at)
    .reduce((acc, a) => acc + (basics.balances.get(a.id) ?? 0n), 0n);

  return {
    basics,
    month,
    today,
    currency,
    minorUnit,
    otherCurrencies,
    balance,
    income: BigInt(current.income),
    expense: BigInt(current.expense),
    prevIncome: BigInt(previous.income),
    prevExpense: BigInt(previous.expense),
    monthly,
    byCategory: top,
    recent: recentRes.data ?? [],
    budgets,
    goals: goalsRes.data ?? [],
  };
}
