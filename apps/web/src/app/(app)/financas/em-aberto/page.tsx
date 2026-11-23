import type { Metadata } from "next";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { FinanceTransaction } from "@anen/types";
import { InlineAction } from "@/components/forms";
import { Badge, ButtonLink, Section, cx } from "@/components/ui";
import { businessScope, loadLinkOptions } from "@/lib/business";
import { categoryLabel, financeScope, loadFinanceBasics, sumByCurrency, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { markSettledAction } from "../actions";
import { DeleteTransactionButton, TransactionForm } from "../finance-forms";

export const metadata: Metadata = { title: "A receber e a pagar" };

const LIMIT = 500;

export default async function OpenItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const today = todayIn(scope.timezone);
  const params = await searchParams;
  const presetKind = params.tipo === "income" || params.tipo === "expense" ? params.tipo : "expense";

  const [basics, links, open, contacts] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    scope.canWrite ? loadLinkOptions(session.supabase, businessScope(session)) : Promise.resolve(undefined),
    session.supabase
      .from("transactions")
      .select("*")
      .eq(scope.column, scope.value)
      .in("payment_status", ["pending", "partial"])
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("occurred_on", { ascending: true })
      .limit(LIMIT),
    session.supabase.from("contacts").select("id, name").eq(scope.column, scope.value),
  ]);
  if (open.error) throw new Error("Falha ao carregar valores em aberto");
  const items = open.data ?? [];
  const contactNames = new Map((contacts.data ?? []).map((c) => [c.id, c.name]));
  const fmt = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);
  const outstanding = (t: FinanceTransaction) => BigInt(t.amount_minor) - BigInt(t.settled_minor);

  const groups = [
    { key: "income" as const, title: m.finance.open.receivables, rows: items.filter((t) => t.kind === "income") },
    { key: "expense" as const, title: m.finance.open.payables, rows: items.filter((t) => t.kind === "expense") },
  ];

  const activeAccounts = basics.accounts.filter((a) => !a.archived_at);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">{m.finance.open.hint}</p>
      {scope.canWrite ? (
        activeAccounts.length > 0 ? (
          <Section title={m.finance.open.new} description={m.finance.open.newHint}>
            <TransactionForm
              m={m}
              accounts={activeAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
              categories={basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
              defaults={{ date: today, kind: presetKind, settlement: "pending" }}
              {...(links ? { links } : {})}
            />
          </Section>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-5">
            <p className="flex-1 text-sm text-muted">{m.finance.open.needAccount}</p>
            <ButtonLink href="/financas/contas" variant="secondary">
              {m.finance.open.createAccount}
            </ButtonLink>
          </div>
        )
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((g) => {
          const totals = sumByCurrency(g.rows.map((t) => ({ currency: t.currency_code, amount: outstanding(t) })));
          const overdue = g.rows.filter((t) => t.due_on && t.due_on < today);
          const overdueTotals = sumByCurrency(overdue.map((t) => ({ currency: t.currency_code, amount: outstanding(t) })));
          return (
            <section key={g.key} className="flex flex-col rounded-xl border border-line bg-surface" aria-labelledby={`open-${g.key}`}>
              <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:px-6">
                <h2 id={`open-${g.key}`} className="flex items-center gap-2 text-base font-semibold">
                  <span className={cx("size-2 rounded-full", g.key === "income" ? "bg-chart-income" : "bg-chart-expense")} aria-hidden />
                  {g.title}
                </h2>
                {totals.size === 0 ? (
                  <p className="text-sm text-muted">{m.finance.open.empty}</p>
                ) : (
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    {[...totals].map(([c, v]) => (
                      <p key={c} className="tabular text-2xl font-semibold">
                        {fmt(v, c)}
                      </p>
                    ))}
                  </div>
                )}
                {overdueTotals.size > 0 ? (
                  <p className="tabular text-sm text-danger">
                    {m.finance.open.overdue}: {[...overdueTotals].map(([c, v]) => fmt(v, c)).join(" · ")}
                  </p>
                ) : null}
              </div>
              {g.rows.length > 0 ? (
                <ul className="flex flex-col px-5 sm:px-6">
                  {g.rows.map((t) => {
                    const isOverdue = Boolean(t.due_on && t.due_on < today);
                    const who = (t.contact_id && contactNames.get(t.contact_id)) || t.counterparty;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.description}</p>
                          <p className="truncate text-xs text-subtle">
                            {who ? `${who} · ` : ""}
                            {t.due_on
                              ? format(isOverdue ? m.finance.open.overdueSince : m.finance.open.due, {
                                  date: formatDate(t.due_on, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }),
                                })
                              : m.finance.open.noDue}
                            {t.document_ref ? ` · ${t.document_ref}` : ""}
                          </p>
                        </div>
                        {isOverdue ? <Badge tone="danger">{m.finance.tx.overdueBadge}</Badge> : t.payment_status === "partial" ? <Badge>{m.finance.tx.partialBadge}</Badge> : null}
                        <div className="text-right">
                          <p className="tabular text-sm font-semibold">{fmt(outstanding(t), t.currency_code)}</p>
                          {t.payment_status === "partial" ? (
                            <p className="tabular text-xs text-subtle">/ {fmt(BigInt(t.amount_minor), t.currency_code)}</p>
                          ) : null}
                        </div>
                        {scope.canWrite ? (
                          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                            <InlineAction
                              action={markSettledAction}
                              fields={{ id: t.id }}
                              label={m.finance.open.markPaid}
                              pendingLabel={m.common.saving}
                              confirmMessage={m.finance.open.markPaidConfirm}
                              variant="secondary"
                            />
                            <ButtonLink
                              href={`/financas/movimentos?mes=${t.occurred_on.slice(0, 7)}&editar=${t.id}`}
                              variant="ghost"
                              aria-label={`${m.finance.open.edit}: ${t.description}`}
                            >
                              {m.finance.open.edit}
                            </ButtonLink>
                            <DeleteTransactionButton m={m} id={t.id} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
      {items.length === LIMIT ? <Section title={m.finance.open.title}><p className="text-xs text-subtle">{format(m.finance.tx.limited, { count: LIMIT })}</p></Section> : null}
    </div>
  );
}
