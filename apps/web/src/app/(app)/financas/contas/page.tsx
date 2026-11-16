import type { Metadata } from "next";
import Link from "next/link";
import { format, formatMoney } from "@anen/i18n";
import { formatAmountInput } from "@anen/validation";
import { Badge, Section, buttonClass } from "@/components/ui";
import { financeScope, loadFinanceBasics, sumByCurrency } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { AccountForm, ArchiveAccountButton } from "../finance-forms";

export const metadata: Metadata = { title: "Contas" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const params = await searchParams;
  const [basics, currencies, used] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase.from("currencies").select("code, name").eq("is_enabled", true).order("code"),
    session.supabase.from("transactions").select("account_id").eq(scope.column, scope.value).limit(1000),
  ]);
  const withTransactions = new Set((used.data ?? []).map((r) => r.account_id));
  const editing = basics.accounts.find((a) => a.id === params.editar);
  const totals = sumByCurrency(
    basics.accounts.filter((a) => !a.archived_at).map((a) => ({ currency: a.currency_code, amount: basics.balances.get(a.id) ?? 0n })),
  );
  const fmt = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);

  return (
    <div className="flex flex-col gap-6">
      {totals.size ? (
        <div className="flex flex-wrap gap-3">
          {[...totals.entries()].map(([c, v]) => (
            <div key={c} className="rounded-xl border border-line bg-surface px-5 py-4">
              <p className="text-sm text-muted">{format(m.finance.account.totalByCurrency, { currency: c })}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{fmt(v, c)}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Section title={m.finance.tabs.accounts}>
        {basics.accounts.length === 0 ? (
          <p className="text-sm text-muted">{m.finance.account.empty}</p>
        ) : (
          <ul className="-my-3 flex flex-col">
            {basics.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line py-4 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {a.name}
                    {a.archived_at ? <Badge>{m.finance.account.archived}</Badge> : null}
                  </p>
                  <p className="text-xs text-subtle">
                    {m.finance.account.kinds[a.kind]} · {a.currency_code}
                  </p>
                </div>
                <span className="tabular text-right text-lg font-semibold">{fmt(basics.balances.get(a.id) ?? 0n, a.currency_code)}</span>
                {scope.canWrite ? (
                  <div className="flex items-start gap-1">
                    <Link href={`/financas/contas?editar=${a.id}`} className={buttonClass("ghost", "h-9 px-3")}>
                      {m.finance.account.edit}
                    </Link>
                    <ArchiveAccountButton m={m} id={a.id} archived={Boolean(a.archived_at)} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {scope.canWrite ? (
        <Section title={editing ? m.finance.account.edit : m.finance.account.new}>
          <AccountForm
            key={editing?.id ?? "new"}
            m={m}
            currencies={currencies.data ?? []}
            defaultCurrency={scope.defaultCurrency}
            {...(editing
              ? {
                  initial: {
                    id: editing.id,
                    name: editing.name,
                    kind: editing.kind,
                    currency: editing.currency_code,
                    opening: formatAmountInput(BigInt(editing.opening_balance_minor), basics.minorUnits.get(editing.currency_code) ?? 2),
                    locked: withTransactions.has(editing.id),
                  },
                }
              : {})}
          />
        </Section>
      ) : null}
    </div>
  );
}
