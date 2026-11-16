import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { CategoryBars, MonthlyChart } from "@/components/charts";
import { EmptyFinance, FinanceKpis, GoalCard, ProgressBar, TransactionList } from "@/components/finance-ui";
import { Section } from "@/components/ui";
import { financeScope } from "@/lib/finance";
import { loadFinanceOverview } from "@/lib/finance-overview";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Finanças" };

export default async function FinanceOverviewPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const o = await loadFinanceOverview(session.supabase, scope, m, locale);

  if (o.basics.accounts.length === 0) return <EmptyFinance m={m} canWrite={scope.canWrite} />;

  const monthLabel = formatDate(`${o.month}-01`, locale, "UTC", { month: "long", year: "numeric" });
  return (
    <div className="flex flex-col gap-6">
      <FinanceKpis
        m={m}
        locale={locale}
        currency={o.currency}
        minorUnit={o.minorUnit}
        balance={o.balance}
        income={o.income}
        expense={o.expense}
        prevIncome={o.prevIncome}
        prevExpense={o.prevExpense}
      />
      {o.otherCurrencies.length ? (
        <p className="text-[13px] text-subtle">{format(m.finance.chart.otherCurrencies, { currencies: o.otherCurrencies.join(", ") })}</p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <MonthlyChart
            data={o.monthly}
            currency={o.currency}
            minorUnit={o.minorUnit}
            locale={locale}
            labels={{
              title: m.finance.chart.monthlyTitle,
              subtitle: format(m.finance.chart.monthlySubtitle, { currency: o.currency }),
              income: m.finance.chart.income,
              expense: m.finance.chart.expense,
              result: m.finance.chart.result,
              month: m.finance.chart.month,
              showTable: m.finance.chart.showTable,
              showChart: m.finance.chart.showChart,
            }}
          />
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <CategoryBars
            data={o.byCategory}
            currency={o.currency}
            minorUnit={o.minorUnit}
            locale={locale}
            title={m.finance.chart.byCategoryTitle}
            subtitle={format(m.finance.chart.byCategorySubtitle, { month: monthLabel, currency: o.currency })}
            empty={m.finance.chart.empty}
          />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={m.finance.recentTitle}>
          <TransactionList
            m={m}
            locale={locale}
            timeZone={scope.timezone}
            transactions={o.recent}
            categories={new Map(o.basics.categories.map((c) => [c.id, c]))}
            accounts={new Map(o.basics.accounts.map((a) => [a.id, a]))}
            minorUnits={o.basics.minorUnits}
          />
          <Link href="/financas/movimentos" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
            {m.finance.seeAll} →
          </Link>
        </Section>
        <div className="flex flex-col gap-6">
          <Section title={m.finance.budget.title}>
            {o.budgets.length === 0 ? (
              <p className="text-sm text-muted">{m.finance.budget.empty}</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {o.budgets.map((b) => {
                  const limit = BigInt(b.amount_minor);
                  const unit = o.basics.minorUnits.get(b.currency_code) ?? 2;
                  const over = b.spent > limit;
                  const fmt = (v: bigint) => formatMoney(v, b.currency_code, unit, locale);
                  return (
                    <li key={b.id} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-3 text-sm">
                        <span>{b.label}</span>
                        <span className="tabular text-muted">{format(m.finance.budget.spent, { spent: fmt(b.spent), limit: fmt(limit) })}</span>
                      </div>
                      <ProgressBar value={b.spent} max={limit} over={over} label={b.label} />
                      <span className={over ? "text-xs text-danger" : "text-xs text-subtle"}>
                        {over ? `⚠ ${format(m.finance.budget.over, { value: fmt(b.spent - limit) })}` : format(m.finance.budget.remaining, { value: fmt(limit - b.spent) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          {o.goals.length ? (
            <Section title={m.finance.goal.title}>
              <div className="grid gap-3">
                {o.goals.slice(0, 3).map((g) => (
                  <GoalCard key={g.id} m={m} locale={locale} goal={g} minorUnit={o.basics.minorUnits.get(g.currency_code) ?? 2} today={o.today} />
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
