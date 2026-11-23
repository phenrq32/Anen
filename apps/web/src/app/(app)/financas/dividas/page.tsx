import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { installmentProgress } from "@anen/financial-engine";
import { ButtonLink, Section } from "@/components/ui";
import { financeScope, loadFinanceBasics, sumByCurrency, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dívidas" };

/** O que está por pagar (Fase 5): parcelamentos de despesa e outros valores em aberto. Só dados registados. */
export default async function DebtsPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const t = m.finance.debts;
  const today = todayIn(scope.timezone);
  const [basics, openRes, plansRes] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase
      .from("transactions")
      .select("id, description, amount_minor, settled_minor, currency_code, due_on, occurred_on, installment_plan_id, installment_number")
      .eq(scope.column, scope.value)
      .eq("kind", "expense")
      .in("payment_status", ["pending", "partial"])
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(2000),
    session.supabase.from("installment_plans").select("*").eq(scope.column, scope.value).eq("kind", "expense").order("created_at"),
  ]);
  if (openRes.error || plansRes.error) throw new Error("Falha ao carregar dívidas");
  const open = openRes.data ?? [];
  const outstanding = (x: { amount_minor: number; settled_minor: number }) => BigInt(x.amount_minor) - BigInt(x.settled_minor);
  const money = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);
  const date = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });

  const totals = sumByCurrency(open.map((x) => ({ currency: x.currency_code, amount: outstanding(x) })));
  const overdue = sumByCurrency(open.filter((x) => (x.due_on ?? x.occurred_on) < today).map((x) => ({ currency: x.currency_code, amount: outstanding(x) })));
  const plans = (plansRes.data ?? [])
    .map((p) => {
      const parcels = open.filter((x) => x.installment_plan_id === p.id);
      const progress = installmentProgress(
        parcels.map((x) => ({ number: x.installment_number ?? 0, amountMinor: BigInt(x.amount_minor), settledMinor: BigInt(x.settled_minor) })),
        p.installment_count,
      );
      return { plan: p, remaining: parcels.length, outstanding: progress.outstandingMinor, next: parcels[0] };
    })
    .filter((x) => x.remaining > 0);
  const others = open.filter((x) => !x.installment_plan_id);

  if (open.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
        <p className="text-sm text-muted">{t.empty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
      <section className="flex flex-wrap gap-6 rounded-xl border border-line bg-surface px-5 py-4" aria-label={t.totalTitle}>
        {[...totals].map(([c, v]) => (
          <div key={c}>
            <p className="text-xs text-subtle">{t.totalTitle}</p>
            <p className="tabular text-2xl font-semibold">{money(v, c)}</p>
            {overdue.get(c) ? <p className="tabular text-xs text-danger">{format(t.overdue, { value: money(overdue.get(c) ?? 0n, c) })}</p> : null}
          </div>
        ))}
      </section>
      {plans.length > 0 ? (
        <Section title={t.installmentsTitle}>
          <ul className="flex flex-col">
            {plans.map(({ plan, remaining, outstanding: owed, next }) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{plan.description}</p>
                  <p className="text-xs text-subtle">
                    {format(t.remaining, { count: remaining })}
                    {next ? ` · ${format(m.finance.installments.nextDue, { date: date(next.due_on ?? next.occurred_on) })}` : ""}
                  </p>
                </div>
                <p className="tabular text-sm font-semibold">{money(owed, plan.currency_code)}</p>
              </li>
            ))}
          </ul>
          <ButtonLink href="/financas/parcelas" variant="ghost" className="mt-3">
            {t.seePlans}
          </ButtonLink>
        </Section>
      ) : null}
      {others.length > 0 ? (
        <Section title={t.othersTitle}>
          <ul className="flex flex-col">
            {others.slice(0, 50).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{x.description}</p>
                  <p className="text-xs text-subtle">{x.due_on ? format(m.finance.open.due, { date: date(x.due_on) }) : m.finance.open.noDue}</p>
                </div>
                <p className="tabular text-sm font-semibold">{money(outstanding(x), x.currency_code)}</p>
              </li>
            ))}
          </ul>
          <ButtonLink href="/financas/em-aberto" variant="ghost" className="mt-3">
            {t.seeOpen}
          </ButtonLink>
        </Section>
      ) : null}
    </div>
  );
}
