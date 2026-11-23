import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { installmentProgress } from "@anen/financial-engine";
import { EmptyFinance } from "@/components/finance-ui";
import { Badge, Section, cx } from "@/components/ui";
import { businessScope, loadLinkOptions } from "@/lib/business";
import { categoryLabel, financeScope, loadFinanceBasics, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { CancelInstallmentsButton, InstallmentPlanForm, UpdateInstallmentsForm } from "../finance-forms";

export const metadata: Metadata = { title: "Parcelas" };

export default async function InstallmentsPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const t = m.finance.installments;
  const today = todayIn(scope.timezone);

  const [basics, links, plansRes] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    scope.canWrite ? loadLinkOptions(session.supabase, businessScope(session)) : Promise.resolve(null),
    session.supabase.from("installment_plans").select("*").eq(scope.column, scope.value).order("created_at", { ascending: false }).limit(200),
  ]);
  if (plansRes.error) throw new Error("Falha ao carregar parcelas");
  const plans = plansRes.data ?? [];
  const parcelsRes = plans.length
    ? await session.supabase
        .from("transactions")
        .select("id, installment_plan_id, installment_number, amount_minor, settled_minor, due_on, occurred_on, payment_status")
        .in("installment_plan_id", plans.map((p) => p.id))
        .eq(scope.column, scope.value)
        .order("installment_number")
    : { data: [], error: null };
  if (parcelsRes.error) throw new Error("Falha ao carregar parcelas");
  const byPlan = new Map<string, NonNullable<typeof parcelsRes.data>>();
  for (const p of parcelsRes.data ?? []) {
    if (!p.installment_plan_id) continue;
    byPlan.set(p.installment_plan_id, [...(byPlan.get(p.installment_plan_id) ?? []), p]);
  }

  const activeAccounts = basics.accounts.filter((a) => !a.archived_at);
  const money = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);
  const date = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
      {scope.canWrite ? (
        activeAccounts.length > 0 ? (
          <Section title={t.new}>
            <InstallmentPlanForm
              m={m}
              locale={locale}
              accounts={activeAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
              categories={basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
              contacts={links?.contacts ?? []}
              minorUnits={Object.fromEntries(basics.minorUnits)}
              today={today}
            />
          </Section>
        ) : (
          <EmptyFinance m={m} canWrite={scope.canWrite} />
        )
      ) : null}

      <Section title={t.title}>
        {plans.length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {plans.map((plan) => {
              const parcels = byPlan.get(plan.id) ?? [];
              const progress = installmentProgress(
                parcels.map((p) => ({ number: p.installment_number ?? 0, amountMinor: BigInt(p.amount_minor), settledMinor: BigInt(p.settled_minor) })),
                plan.installment_count,
              );
              const next = parcels.find((p) => BigInt(p.settled_minor) < BigInt(p.amount_minor));
              const present = new Set(parcels.map((p) => p.installment_number));
              return (
                <li key={plan.id} className="flex flex-col gap-3 border-b border-line py-4 last:border-0" aria-label={plan.description}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <span className={cx("size-2 rounded-full", plan.kind === "income" ? "bg-chart-income" : "bg-chart-expense")} aria-hidden />
                        {plan.description}
                      </p>
                      <p className="mt-1 text-xs text-subtle">
                        {format(t.progress, { paid: progress.paid, remaining: progress.remaining })}
                        {next ? ` · ${format(t.nextDue, { date: date(next.due_on ?? next.occurred_on) })}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-subtle">{t.outstanding}</p>
                      <p className="tabular text-lg font-semibold">{money(progress.outstandingMinor, plan.currency_code)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {plan.cancelled_from ? <Badge>{format(t.cancelledFrom, { n: plan.cancelled_from })}</Badge> : null}
                    {progress.remaining === 0 && !plan.cancelled_from ? <Badge tone="brand">{t.finished}</Badge> : null}
                    {scope.canWrite && progress.remaining > 0 ? <CancelInstallmentsButton m={m} planId={plan.id} /> : null}
                  </div>
                  <details className="group rounded-lg border border-line">
                    <summary className="flex h-11 cursor-pointer list-none items-center px-4 text-sm font-medium text-muted hover:text-paper">{t.parcels}</summary>
                    <div className="flex flex-col gap-4 border-t border-line p-4">
                      <table className="w-full text-sm">
                        <tbody>
                          {Array.from({ length: plan.installment_count }, (_, i) => i + 1).map((n) => {
                            const p = parcels.find((x) => x.installment_number === n);
                            const status = !p ? "cancelled" : p.payment_status;
                            return (
                              <tr key={n} className="border-b border-line last:border-0">
                                <td className="py-2">{format(t.parcel, { n, total: plan.installment_count })}</td>
                                <td className="py-2 text-subtle">{p ? date(p.due_on ?? p.occurred_on) : "—"}</td>
                                <td className="tabular py-2 text-right">{p ? money(BigInt(p.amount_minor), plan.currency_code) : "—"}</td>
                                <td className="py-2 text-right">
                                  <Badge tone={status === "paid" ? "brand" : "neutral"}>{t.statuses[status]}</Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {scope.canWrite && next && present.size > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-medium">{t.updateTitle}</p>
                          <UpdateInstallmentsForm m={m} planId={plan.id} from={next.installment_number ?? 1} max={plan.installment_count} />
                        </div>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
