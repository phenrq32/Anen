import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { formatAmountInput, monthParam } from "@anen/validation";
import { GoalCard, ProgressBar } from "@/components/finance-ui";
import { Section } from "@/components/ui";
import { categoryLabel, financeScope, loadFinanceBasics, monthBounds, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { BudgetForm, DeleteBudgetButton, DeleteGoalButton, GoalForm } from "../finance-forms";

export const metadata: Metadata = { title: "Orçamentos e objetivos" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const params = await searchParams;
  const today = todayIn(scope.timezone);
  const month = params.mes && monthParam.safeParse(params.mes).success ? params.mes : today.slice(0, 7);
  const { from, to } = monthBounds(month);

  const [basics, budgetsRes, spentRes, goalsRes, currencies] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase.from("budgets").select("*").eq(scope.column, scope.value).eq("period_start", from),
    session.supabase.rpc("finance_by_category", { p_org: scope.orgId, p_from: from, p_to: to, p_kind: "expense" }),
    session.supabase.from("savings_goals").select("*").eq(scope.column, scope.value).order("created_at"),
    session.supabase.from("currencies").select("code").eq("is_enabled", true).order("code"),
  ]);
  const categories = new Map(basics.categories.map((c) => [c.id, c]));
  const spent = new Map((spentRes.data ?? []).map((r) => [`${r.category_id}:${r.currency_code}`, BigInt(r.total)]));
  const currencyCodes = (currencies.data ?? []).map((c) => c.code);
  const monthLabel = formatDate(`${month}-01`, locale, "UTC", { month: "long", year: "numeric" });
  const categoryOptions = basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }));

  return (
    <div className="flex flex-col gap-6">
      <Section title={`${m.finance.budget.title} · ${monthLabel}`}>
        <form method="get" className="mb-5 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-subtle">
            {m.finance.budget.month}
            <input type="month" name="mes" defaultValue={month} className="h-10 rounded-md border border-line bg-ink px-3 text-sm text-paper" />
          </label>
          <button type="submit" className="h-10 rounded-md border border-line px-3 text-sm text-muted hover:text-paper">{m.finance.tx.filters.apply}</button>
        </form>
        {(budgetsRes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{m.finance.budget.empty}</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {(budgetsRes.data ?? []).map((b) => {
              const limit = BigInt(b.amount_minor);
              const used = spent.get(`${b.category_id}:${b.currency_code}`) ?? 0n;
              const unit = basics.minorUnits.get(b.currency_code) ?? 2;
              const fmt = (v: bigint) => formatMoney(v, b.currency_code, unit, locale);
              const over = used > limit;
              const label = categoryLabel(m, categories.get(b.category_id));
              return (
                <li key={b.id} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-muted">{format(m.finance.budget.spent, { spent: fmt(used), limit: fmt(limit) })}</span>
                      {scope.canWrite ? <DeleteBudgetButton m={m} id={b.id} /> : null}
                    </span>
                  </div>
                  <ProgressBar value={used} max={limit} over={over} label={label} />
                  <span className={over ? "text-xs text-danger" : "text-xs text-subtle"}>
                    {over ? `⚠ ${format(m.finance.budget.over, { value: fmt(used - limit) })}` : format(m.finance.budget.remaining, { value: fmt(limit - used) })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {scope.canWrite ? (
          <div className="mt-6 border-t border-line pt-5">
            <BudgetForm m={m} categories={categoryOptions} month={month} currencies={currencyCodes} defaultCurrency={scope.defaultCurrency} />
          </div>
        ) : null}
      </Section>

      <Section title={m.finance.goal.title}>
        {(goalsRes.data ?? []).length === 0 ? <p className="mb-4 text-sm text-muted">{m.finance.goal.empty}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {(goalsRes.data ?? []).map((g) => {
            const unit = basics.minorUnits.get(g.currency_code) ?? 2;
            return (
              <GoalCard
                key={g.id}
                m={m}
                locale={locale}
                goal={g}
                minorUnit={unit}
                today={today}
                actions={
                  scope.canWrite ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted hover:text-paper">{m.finance.goal.update}</summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <GoalForm
                          m={m}
                          currencies={currencyCodes}
                          defaultCurrency={g.currency_code}
                          initial={{
                            id: g.id,
                            name: g.name,
                            target: formatAmountInput(BigInt(g.target_minor), unit),
                            saved: formatAmountInput(BigInt(g.saved_minor), unit),
                            currency: g.currency_code,
                            targetDate: g.target_date,
                          }}
                        />
                        <DeleteGoalButton m={m} id={g.id} />
                      </div>
                    </details>
                  ) : undefined
                }
              />
            );
          })}
        </div>
        {scope.canWrite ? (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="mb-4 text-sm font-semibold">{m.finance.goal.new}</h3>
            <GoalForm m={m} currencies={currencyCodes} defaultCurrency={scope.defaultCurrency} />
          </div>
        ) : null}
      </Section>
    </div>
  );
}
