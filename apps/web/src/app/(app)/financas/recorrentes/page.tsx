import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { Badge, Section } from "@/components/ui";
import { categoryLabel, financeScope, loadFinanceBasics, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { RecurringActions, RecurringForm } from "../finance-forms";

export const metadata: Metadata = { title: "Recorrentes" };

export default async function RecurringPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const [basics, recurringRes] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase.from("recurring_transactions").select("*").eq(scope.column, scope.value).order("next_run_on"),
  ]);
  const categories = new Map(basics.categories.map((c) => [c.id, c]));
  const accounts = new Map(basics.accounts.map((a) => [a.id, a]));
  const items = recurringRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Section title={m.finance.recurring.title} description={m.finance.recurring.note}>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{m.finance.recurring.empty}</p>
        ) : (
          <ul className="-my-3 flex flex-col">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line py-4 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {r.description}
                    <Badge tone={r.is_active ? "brand" : "neutral"}>{r.is_active ? m.finance.recurring.active : m.finance.recurring.paused}</Badge>
                  </p>
                  <p className="text-xs text-subtle">
                    {m.finance.recurring.frequencies[r.frequency]}
                    {r.interval_count > 1 ? ` ×${r.interval_count}` : ""} · {categoryLabel(m, r.category_id ? categories.get(r.category_id) : undefined)} ·{" "}
                    {accounts.get(r.account_id)?.name ?? ""} · {format(m.finance.recurring.next, { date: formatDate(r.next_run_on, locale, "UTC") })}
                  </p>
                </div>
                <span className="tabular font-semibold">
                  {r.kind === "income" ? "+" : "−"}
                  {formatMoney(BigInt(r.amount_minor), r.currency_code, basics.minorUnits.get(r.currency_code) ?? 2, locale)}
                </span>
                {scope.canWrite ? <RecurringActions m={m} id={r.id} active={r.is_active} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {scope.canWrite && basics.accounts.some((a) => !a.archived_at) ? (
        <Section title={m.finance.recurring.new}>
          <RecurringForm
            m={m}
            accounts={basics.accounts.filter((a) => !a.archived_at).map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
            categories={basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
            today={todayIn(scope.timezone)}
          />
        </Section>
      ) : null}
    </div>
  );
}
