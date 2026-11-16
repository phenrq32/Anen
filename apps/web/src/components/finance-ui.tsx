import Link from "next/link";
import { marginPercent, decimalToString, moneyFromMinor, subtract } from "@anen/financial-engine";
import { format, formatDate, formatMoney, type Messages } from "@anen/i18n";
import type { FinanceTransaction, Locale, SavingsGoal, TransactionCategory, FinancialAccount } from "@anen/types";
import { AnimatedMoney } from "@/components/charts";
import { Badge, cx } from "@/components/ui";
import { categoryLabel } from "@/lib/finance";

function delta(m: Messages, current: bigint, previous: bigint, currency: string, minorUnit: number, locale: Locale): string {
  return format(m.finance.kpi.previous, { value: formatMoney(previous, currency, minorUnit, locale) }) + (current === previous ? "" : "");
}

export function FinanceKpis({
  m,
  locale,
  currency,
  minorUnit,
  balance,
  income,
  expense,
  prevIncome,
  prevExpense,
}: {
  m: Messages;
  locale: Locale;
  currency: string;
  minorUnit: number;
  balance: bigint;
  income: bigint;
  expense: bigint;
  prevIncome: bigint;
  prevExpense: bigint;
}) {
  const result = income - expense;
  let margin: string | null = null;
  try {
    const value = marginPercent(subtract(moneyFromMinor(income, currency), moneyFromMinor(expense, currency)), moneyFromMinor(income, currency), 1);
    margin = value ? `${decimalToString(value).replace(".", ",")} %` : null;
  } catch {
    margin = null;
  }
  const tiles = [
    { label: m.finance.kpi.balance, value: balance, note: null as string | null, tone: "neutral" },
    { label: m.finance.kpi.income, value: income, note: delta(m, income, prevIncome, currency, minorUnit, locale), tone: "income" },
    { label: m.finance.kpi.expenses, value: expense, note: delta(m, expense, prevExpense, currency, minorUnit, locale), tone: "expense" },
    { label: m.finance.kpi.result, value: result, note: `${m.finance.kpi.margin}: ${margin ?? m.finance.kpi.noRevenue}`, tone: result < 0n ? "negative" : "result" },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="flex min-w-0 flex-col gap-2 bg-surface p-4 sm:p-5">
          <span className="flex items-center gap-2 text-sm text-muted">
            {t.tone === "income" ? <span className="size-2 rounded-full bg-chart-income" aria-hidden /> : null}
            {t.tone === "expense" ? <span className="size-2 rounded-full bg-chart-expense" aria-hidden /> : null}
            {t.label}
          </span>
          <AnimatedMoney
            amountMinor={String(t.value)}
            currency={currency}
            minorUnit={minorUnit}
            locale={locale}
            className={cx(
              "truncate text-xl font-semibold sm:text-2xl",
              t.tone === "result" && t.value > 0n && "text-brand",
              t.tone === "negative" && "text-danger",
            )}
          />
          {t.note ? <span className="truncate text-xs text-subtle">{t.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function TransactionList({
  m,
  locale,
  timeZone,
  transactions,
  categories,
  accounts,
  minorUnits,
  actions,
  today,
}: {
  m: Messages;
  locale: Locale;
  timeZone: string;
  transactions: FinanceTransaction[];
  categories: Map<string, TransactionCategory>;
  accounts: Map<string, FinancialAccount>;
  minorUnits: Map<string, number>;
  actions?: (tx: FinanceTransaction) => React.ReactNode;
  /** Data de hoje (YYYY-MM-DD) para assinalar vencidos. */
  today?: string;
}) {
  if (transactions.length === 0) return <p className="py-4 text-sm text-muted">{m.finance.tx.empty}</p>;
  return (
    <ul className="-my-2 flex flex-col">
      {transactions.map((tx) => {
        const category = tx.category_id ? categories.get(tx.category_id) : undefined;
        const signed = BigInt(tx.amount_minor) * (tx.kind === "expense" ? -1n : 1n);
        return (
          <li key={tx.id} className="group flex items-center gap-3 border-b border-line py-3 last:border-0">
            <span
              className={cx(
                "grid size-9 shrink-0 place-items-center rounded-full text-sm",
                tx.kind === "income" ? "bg-chart-income/15 text-chart-income" : "bg-chart-expense/15 text-chart-expense",
              )}
              aria-hidden
            >
              {tx.kind === "income" ? "↑" : "↓"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{tx.description}</p>
              <p className="truncate text-xs text-subtle">
                {formatDate(tx.occurred_on, locale, "UTC", { day: "2-digit", month: "short" })}
                {" · "}
                {categoryLabel(m, category)}
                {accounts.get(tx.account_id) ? ` · ${accounts.get(tx.account_id)!.name}` : ""}
                {tx.counterparty ? ` · ${tx.counterparty}` : ""}
              </p>
            </div>
            {tx.recurring_id ? <Badge>{m.finance.tx.recurringBadge}</Badge> : null}
            {tx.payment_status !== "paid" ? (
              <Badge tone={today && tx.due_on && tx.due_on < today ? "danger" : "neutral"}>
                {today && tx.due_on && tx.due_on < today
                  ? m.finance.tx.overdueBadge
                  : tx.payment_status === "partial"
                    ? m.finance.tx.partialBadge
                    : m.finance.tx.pendingBadge}
              </Badge>
            ) : null}
            <span className={cx("tabular shrink-0 text-right text-sm font-semibold", tx.kind === "income" ? "text-paper" : "text-muted")}>
              {tx.kind === "income" ? "+" : "−"}
              {formatMoney(signed < 0n ? -signed : signed, tx.currency_code, minorUnits.get(tx.currency_code) ?? 2, locale)}
            </span>
            {actions ? <div className="shrink-0">{actions(tx)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ProgressBar({ value, max, over = false, label }: { value: bigint; max: bigint; over?: boolean; label: string }) {
  const pct = max > 0n ? Math.min(100, Number((value * 1000n) / max) / 10) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-graphite" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width] duration-700 ease-out", over ? "bg-danger" : "bg-brand")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function GoalCard({
  m,
  locale,
  goal,
  minorUnit,
  today,
  actions,
}: {
  m: Messages;
  locale: Locale;
  goal: SavingsGoal;
  minorUnit: number;
  today: string;
  actions?: React.ReactNode;
}) {
  const target = BigInt(goal.target_minor);
  const saved = BigInt(goal.saved_minor);
  const done = saved >= target;
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    target > 0n ? Math.min(1, Number((saved * 1000n) / target) / 1000) : 0,
  );
  let perMonth: string | null = null;
  if (!done && goal.target_date && goal.target_date > today) {
    const [ty, tm] = goal.target_date.split("-").map(Number) as [number, number];
    const [cy, cm] = today.split("-").map(Number) as [number, number];
    const months = BigInt(Math.max(1, (ty - cy) * 12 + (tm - cm)));
    perMonth = format(m.finance.goal.perMonth, {
      value: formatMoney((target - saved + months - 1n) / months, goal.currency_code, minorUnit, locale),
      date: formatDate(goal.target_date, locale, "UTC", { month: "short", year: "numeric" }),
    });
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{goal.name}</p>
          <p className="tabular text-sm text-muted">
            {formatMoney(saved, goal.currency_code, minorUnit, locale)} / {formatMoney(target, goal.currency_code, minorUnit, locale)}
          </p>
        </div>
        {done ? <Badge tone="brand">✓ {m.finance.goal.achieved}</Badge> : <span className="tabular text-sm font-semibold text-brand">{percent}</span>}
      </div>
      <ProgressBar value={saved} max={target} label={format(m.finance.goal.progress, { percent })} />
      {perMonth ? <p className="text-xs text-subtle">{perMonth}</p> : null}
      {actions}
    </div>
  );
}

export function EmptyFinance({ m, canWrite }: { m: Messages; canWrite: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-graphite-soft p-6 sm:p-8">
      <svg viewBox="0 0 120 100" className="h-10 w-auto" aria-hidden>
        <polyline points="6,90 36,58 58,76" fill="none" stroke="#353535" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="58" y1="76" x2="99" y2="25" stroke="#FF851B" strokeWidth="10" strokeLinecap="round" />
      </svg>
      <div>
        <h2 className="text-lg font-semibold">{m.finance.onboardingTitle}</h2>
        <p className="mt-1 max-w-lg text-sm text-muted">{m.finance.onboardingBody}</p>
      </div>
      {canWrite ? (
        <Link href="/financas/contas" className="inline-flex h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover">
          {m.finance.account.new}
        </Link>
      ) : null}
    </div>
  );
}
