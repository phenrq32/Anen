import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { InlineAction } from "@/components/forms";
import { Badge, PageHeader, Section } from "@/components/ui";
import { sumByCurrency } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { confirmTransferAction } from "../bank-actions";
import { currentPlanLimits, PLAN_LIMIT_KEYS } from "@/lib/plan-limits";
import { PlanLimitForm } from "./limit-form";

export const metadata: Metadata = { title: "Pagamentos dos planos" };

/** Só administradores da plataforma: transferências por confirmar e vendas recentes. */
export default async function BillingAdminPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const { data: admin } = await session.supabase.from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle();
  if (!admin) notFound();
  const t = m.billing.admin;
  const [{ data: orders }, { data: limitRows }, { data: plans }] = await Promise.all([
    session.supabase.from("billing_orders").select("*").order("created_at", { ascending: false }).limit(300),
    session.supabase.from("plan_limits").select("plan_key, limit_key, value, valid_from, source"),
    session.supabase.from("plans").select("key, name").order("position"),
  ]);
  const limits = currentPlanLimits(limitRows ?? [], new Date().toISOString().slice(0, 10));
  const tl = m.billing.limits;
  const pending = (orders ?? []).filter((o) => o.status === "pending" && o.provider === "bank_transfer");
  const paid = (orders ?? []).filter((o) => o.status === "paid");
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const monthTotals = sumByCurrency(paid.filter((o) => (o.paid_at ?? "") >= monthStart).map((o) => ({ currency: o.currency_code, amount: BigInt(o.amount_minor) })));
  const money = (minor: number, currency: string) => formatMoney(BigInt(minor), currency, 2, locale);
  const day = (iso: string) => formatDate(iso, locale, session.preferences.timezone, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const name = (o: { plan_key: string; months: number }) => `${o.plan_key === "max" ? "Max" : "Pro"} · ${format(t.months, { months: o.months })}`;

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="glass spot rounded-2xl border p-4">
          <p className="text-sm text-muted">{t.pendingCount}</p>
          <p className="tabular text-2xl font-bold">{pending.length}</p>
        </div>
        <div className="glass spot rounded-2xl border p-4 sm:col-span-2">
          <p className="text-sm text-muted">{t.thisMonth}</p>
          <p className="tabular text-2xl font-bold text-brand">
            {monthTotals.size === 0 ? "—" : [...monthTotals].map(([c, v]) => money(Number(v), c)).join(" · ")}
          </p>
        </div>
      </div>
      <Section title={t.pendingTitle} description={t.pendingHint}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">{t.nonePending}</p>
        ) : (
          <ul className="-my-2 flex flex-col">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm font-semibold">{o.order_nsu}</span>
                  <span className="text-xs text-subtle">
                    {name(o)} · {day(o.created_at)}
                  </span>
                </span>
                <span className="tabular font-semibold">{money(o.amount_minor, o.currency_code)}</span>
                <InlineAction action={confirmTransferAction} fields={{ id: o.id }} label={t.confirm} pendingLabel={m.common.saving} confirmMessage={format(t.confirmAsk, { ref: o.order_nsu })} variant="primary" />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.recentTitle}>
        {paid.length === 0 ? (
          <p className="text-sm text-muted">{t.noneSold}</p>
        ) : (
          <ul className="-my-2 flex flex-col">
            {paid.slice(0, 50).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0">
                <span>
                  {name(o)} <span className="text-subtle">· {o.paid_at ? day(o.paid_at) : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={o.provider === "infinitepay" ? "brand" : "neutral"}>{o.provider === "infinitepay" ? "InfinitePay" : "IBAN"}</Badge>
                  <span className="tabular font-semibold">{money(o.amount_minor, o.currency_code)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={tl.title} description={tl.hint}>
        <div className="flex flex-col gap-6">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-subtle">
                  <th className="py-2 font-medium">{tl.key}</th>
                  {(plans ?? []).map((p) => (
                    <th key={p.key} className="py-2 text-right font-medium">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_LIMIT_KEYS.map((k) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <td className="py-2">{tl.keys[k]}</td>
                    {(plans ?? []).map((p) => {
                      const r = limits.get(p.key)?.get(k);
                      return (
                        <td key={p.key} className="tabular py-2 text-right" title={r?.source}>
                          {r?.value ?? tl.none}
                          {r ? <span className="block text-xs text-subtle">{format(tl.since, { date: formatDate(r.valid_from, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }) })}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PlanLimitForm m={m} plans={plans ?? []} />
        </div>
      </Section>
    </>
  );
}
