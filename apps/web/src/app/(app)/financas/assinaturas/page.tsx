import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { annualEquivalentMinor, monthlyEquivalentMinor, occurrenceDate } from "@anen/financial-engine";
import type { RecurringTransaction } from "@anen/types";
import { ButtonLink, Section } from "@/components/ui";
import { financeScope, loadFinanceBasics, materializeDue, sumByCurrency } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Assinaturas" };

/** Assinaturas e compromissos fixos (Fase 5, §5.5), a partir dos movimentos recorrentes ativos. */
export default async function SubscriptionsPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const t = m.finance.subscriptions;
  await materializeDue(session.supabase, scope);
  const [basics, recurringRes] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase.from("recurring_transactions").select("*").eq(scope.column, scope.value).eq("is_active", true).order("amount_minor", { ascending: false }).limit(500),
  ]);
  if (recurringRes.error) throw new Error("Falha ao carregar recorrentes");
  const rules = recurringRes.data ?? [];
  const money = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);
  const date = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });

  const group = (kind: "income" | "expense", title: string) => {
    const list = rules.filter((r) => r.kind === kind);
    if (list.length === 0) return null;
    const monthly = (r: RecurringTransaction) => monthlyEquivalentMinor(BigInt(r.amount_minor), r.frequency, r.interval_count);
    const totalsMonth = sumByCurrency(list.map((r) => ({ currency: r.currency_code, amount: monthly(r) })));
    const totalsYear = sumByCurrency(list.map((r) => ({ currency: r.currency_code, amount: annualEquivalentMinor(BigInt(r.amount_minor), r.frequency, r.interval_count) })));
    return (
      <Section title={title}>
        <ul className="flex flex-col">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.description}</p>
                <p className="text-xs text-subtle">
                  {t.frequencies[r.frequency]}
                  {r.interval_count > 1 ? ` · ${format(t.every, { n: r.interval_count })}` : ""} ·{" "}
                  {format(t.next, { date: date(occurrenceDate({ startOn: r.start_on, frequency: r.frequency, intervalCount: r.interval_count }, r.occurrence_count)) })}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-semibold">{money(BigInt(r.amount_minor), r.currency_code)}</p>
                {r.frequency !== "monthly" || r.interval_count !== 1 ? (
                  <p className="tabular text-xs text-subtle">
                    {money(monthly(r), r.currency_code)} {t.perMonth}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1 border-t border-line pt-4 text-sm">
          {[...totalsMonth].map(([c, v]) => (
            <p key={c} className="tabular font-semibold">
              {format(t.totalMonth, { value: money(v, c) })}
            </p>
          ))}
          {[...totalsYear].map(([c, v]) => (
            <p key={c} className="tabular text-subtle">
              {format(t.totalYear, { value: money(v, c) })}
            </p>
          ))}
        </div>
      </Section>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
      {rules.length === 0 ? (
        <p className="text-sm text-muted">{t.empty}</p>
      ) : (
        <>
          {group("expense", t.expenses)}
          {group("income", t.incomes)}
          <p className="text-xs text-subtle">{t.equivalentNote}</p>
        </>
      )}
      {scope.canWrite ? (
        <ButtonLink href="/financas/recorrentes" variant="secondary" className="self-start">
          {t.manage}
        </ButtonLink>
      ) : null}
    </div>
  );
}
