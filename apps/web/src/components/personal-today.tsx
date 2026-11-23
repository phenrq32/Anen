import { format, formatDate, formatMoney, type Messages } from "@anen/i18n";
import type { Budget, Locale, SavingsGoal } from "@anen/types";
import { addDays } from "@anen/financial-engine";
import { ProgressBar } from "@/components/finance-ui";
import { ButtonLink, Section, cx } from "@/components/ui";
import { loadCommitments } from "@/lib/commitments";
import { sumByCurrency, type FinanceScope } from "@/lib/finance";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * "Hoje" do espaço pessoal (Fase 5, §5.1): próximos pagamentos previstos, orçamento disponível do mês e
 * objetivos. Só dados registados; nada previsto é dado como pago.
 */
export async function PersonalToday({
  m,
  locale,
  supabase,
  scope,
  today,
  minorUnits,
  budgets,
  goals,
}: {
  m: Messages;
  locale: Locale;
  supabase: ServerClient;
  scope: FinanceScope;
  today: string;
  minorUnits: Map<string, number>;
  budgets: Array<Budget & { spent: bigint }>;
  goals: SavingsGoal[];
}) {
  const d = m.dashboard;
  const upcoming = (await loadCommitments(supabase, scope, { from: today, until: addDays(today, 14), today, includeOverdue: true })).slice(0, 8);
  const money = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);
  const date = (iso: string) => formatDate(iso, locale, "UTC", { day: "2-digit", month: "short" });
  const left = sumByCurrency(budgets.map((b) => ({ currency: b.currency_code, amount: BigInt(b.amount_minor) - b.spent })));
  const limits = sumByCurrency(budgets.map((b) => ({ currency: b.currency_code, amount: BigInt(b.amount_minor) })));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section title={d.upcomingTitle} description={d.upcomingHint}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">{d.upcomingEmpty}</p>
        ) : (
          <ul className="flex flex-col">
            {upcoming.map((it) => (
              <li key={it.key} className="flex items-center gap-3 border-b border-line py-2 text-sm last:border-0">
                <span className={cx("w-14 shrink-0 text-xs", it.overdue ? "text-danger" : "text-subtle")}>{date(it.date)}</span>
                <span className="min-w-0 flex-1 truncate">{it.description}</span>
                <span className="tabular font-medium">
                  {it.kind === "income" ? "+" : "−"}
                  {money(it.amountMinor, it.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ButtonLink href="/financas/calendario" variant="ghost" className="mt-3 -ml-3">
          {d.upcomingAll} →
        </ButtonLink>
      </Section>
      <Section title={d.budgetLeftTitle}>
        {limits.size === 0 ? (
          <p className="text-sm text-muted">{d.budgetNone}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...limits].map(([c, limit]) => {
              const value = left.get(c) ?? 0n;
              return (
                <li key={c} className="flex flex-col gap-1.5">
                  <p className={cx("tabular text-sm", value < 0n ? "text-danger" : undefined)}>{format(d.budgetLeft, { value: money(value, c), limit: money(limit, c) })}</p>
                  <ProgressBar value={limit - value} max={limit} over={value < 0n} label={d.budgetLeftTitle} />
                </li>
              );
            })}
          </ul>
        )}
        <ButtonLink href="/financas/orcamentos" variant="ghost" className="mt-3 -ml-3">
          {m.nav.budgetGoals} →
        </ButtonLink>
      </Section>
      <Section title={d.goalsTitle}>
        {goals.length === 0 ? (
          <p className="text-sm text-muted">{d.goalsNone}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {goals.slice(0, 4).map((g) => (
              <li key={g.id} className="flex flex-col gap-1.5">
                <p className="flex justify-between gap-2 text-sm">
                  <span className="truncate">{g.name}</span>
                  <span className="tabular text-subtle">
                    {money(BigInt(g.saved_minor), g.currency_code)} / {money(BigInt(g.target_minor), g.currency_code)}
                  </span>
                </p>
                <ProgressBar value={BigInt(g.saved_minor)} max={BigInt(g.target_minor)} label={g.name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
