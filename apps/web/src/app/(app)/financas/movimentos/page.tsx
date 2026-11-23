import type { Metadata } from "next";
import Link from "next/link";
import { format, formatMoney } from "@anen/i18n";
import { formatAmountInput, monthParam, periodKind } from "@anen/validation";
import { EmptyFinance, TransactionList } from "@/components/finance-ui";
import { Alert, Section, buttonClass } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { businessScope, loadLinkOptions } from "@/lib/business";
import { categoryLabel, financeScope, loadFinanceBasics, loadInstallmentCounts, materializeDue, monthBounds, sumByCurrency, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { AttachmentsPanel } from "../attachments";
import { DeleteTransactionButton, TransactionForm } from "../finance-forms";

export const metadata: Metadata = { title: "Movimentos" };

const LIMIT = 300;
const UUID = /^[0-9a-f-]{36}$/;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const params = await searchParams;
  const presetProject = params.projeto && UUID.test(params.projeto) ? params.projeto : undefined;
  await materializeDue(session.supabase, scope);
  const [basics, links] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    loadLinkOptions(session.supabase, businessScope(session)),
  ]);
  if (basics.accounts.length === 0) return <EmptyFinance m={m} canWrite={scope.canWrite} />;

  const today = todayIn(scope.timezone);
  const month = monthParam.safeParse(params.mes).success && params.mes ? params.mes : today.slice(0, 7);
  const { from, to } = monthBounds(month);
  const account = params.conta && UUID.test(params.conta) ? params.conta : "";
  const category = params.categoria && UUID.test(params.categoria) ? params.categoria : "";
  const kind = params.tipo === "income" || params.tipo === "expense" ? params.tipo : "";
  const search = (params.q ?? "").slice(0, 80);

  let query = session.supabase
    .from("transactions")
    .select("*")
    .eq(scope.column, scope.value)
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (account) query = query.eq("account_id", account);
  if (category) query = query.eq("category_id", category);
  if (kind) query = query.eq("kind", kind);
  if (search) query = query.ilike("description", `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await query;
  if (error) throw new Error("Falha ao carregar movimentos");
  const transactions = data ?? [];
  const { data: attachmentRows } = transactions.length
    ? await session.supabase
        .from("transaction_attachments")
        .select("id, transaction_id, file_name, size_bytes, created_at")
        .in("transaction_id", transactions.map((t) => t.id))
        .order("created_at")
    : { data: [] };
  const installmentCounts = await loadInstallmentCounts(session.supabase, scope, transactions);
  const attachmentCounts = new Map<string, number>();
  for (const a of attachmentRows ?? []) attachmentCounts.set(a.transaction_id, (attachmentCounts.get(a.transaction_id) ?? 0) + 1);

  const editing = params.editar && UUID.test(params.editar) ? transactions.find((t) => t.id === params.editar) : undefined;
  const viewing = params.anexos && UUID.test(params.anexos) ? transactions.find((t) => t.id === params.anexos) : undefined;
  const panelTx = editing ?? viewing;
  const publicEnv = getPublicEnv();
  const accountsMap = new Map(basics.accounts.map((a) => [a.id, a]));
  const categoriesMap = new Map(basics.categories.map((c) => [c.id, c]));
  const activeAccounts = basics.accounts.filter((a) => !a.archived_at);
  const accountOptions = activeAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }));
  const categoryOptions = basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }));

  const incomeBy = sumByCurrency(transactions.filter((t) => t.kind === "income").map((t) => ({ currency: t.currency_code, amount: BigInt(t.amount_minor) })));
  const expenseBy = sumByCurrency(transactions.filter((t) => t.kind === "expense").map((t) => ({ currency: t.currency_code, amount: BigInt(t.amount_minor) })));
  const currencies = [...new Set([...incomeBy.keys(), ...expenseBy.keys()])].sort();
  const fmt = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);

  const exportParams = new URLSearchParams({ mes: month, ...(account ? { conta: account } : {}), ...(category ? { categoria: category } : {}), ...(kind ? { tipo: kind } : {}) });
  const selectClass = "h-10 rounded-md border border-line bg-surface px-3 text-sm text-paper focus:border-brand focus:outline-none";

  return (
    <div className="flex flex-col gap-6">
      {scope.canWrite ? (
        <Section title={editing ? m.finance.tx.edit : m.finance.tx.new}>
          <TransactionForm
            key={editing?.id ?? "new"}
            m={m}
            accounts={editing ? basics.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency_code })) : accountOptions}
            categories={categoryOptions}
            defaults={{ date: today, ...(presetProject ? { projectId: presetProject } : {}) }}
            links={links}
            {...(editing
              ? {
                  initial: {
                    id: editing.id,
                    kind: editing.kind,
                    amount: formatAmountInput(BigInt(editing.amount_minor), basics.minorUnits.get(editing.currency_code) ?? 2),
                    occurredOn: editing.occurred_on,
                    period: editing.period_start && editing.period_end ? periodKind(editing.period_start, editing.period_end) : null,
                    accountId: editing.account_id,
                    categoryId: editing.category_id,
                    description: editing.description,
                    counterparty: editing.counterparty,
                    notes: editing.notes,
                    contactId: editing.contact_id,
                    projectId: editing.project_id,
                    costCenterId: editing.cost_center_id,
                    costKind: editing.cost_kind,
                    dueOn: editing.due_on,
                    tax: editing.tax_minor === null ? null : formatAmountInput(BigInt(editing.tax_minor), basics.minorUnits.get(editing.currency_code) ?? 2),
                    settlement: editing.payment_status,
                    settled: editing.payment_status === "partial" ? formatAmountInput(BigInt(editing.settled_minor), basics.minorUnits.get(editing.currency_code) ?? 2) : null,
                    paymentMethod: editing.payment_method,
                    documentRef: editing.document_ref,
                  },
                }
              : {})}
          />
          {editing ? (
            <Link href={`/financas/movimentos?mes=${month}`} className="mt-3 inline-block text-sm text-muted hover:text-paper">
              {m.common.cancel}
            </Link>
          ) : null}
        </Section>
      ) : null}

      {params.anexo === "indisponivel" ? <Alert tone="error">{m.finance.attachments.unavailable}</Alert> : null}
      {panelTx && publicEnv ? (
        <Section title={`${m.finance.attachments.title} · ${panelTx.description}`}>
          <AttachmentsPanel
            m={m}
            transactionId={panelTx.id}
            canWrite={scope.canWrite}
            storage={{ url: publicEnv.supabaseUrl, key: publicEnv.supabaseKey }}
            items={(attachmentRows ?? [])
              .filter((a) => a.transaction_id === panelTx.id)
              .map((a) => ({ id: a.id, fileName: a.file_name, sizeLabel: sizeLabel(a.size_bytes, locale) }))}
          />
        </Section>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <label className="flex flex-col gap-1 text-xs text-subtle">
          {m.finance.tx.filters.month}
          <input type="month" name="mes" defaultValue={month} className={selectClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          {m.finance.tx.filters.account}
          <select name="conta" defaultValue={account} className={selectClass}>
            <option value="">{m.finance.tx.filters.all}</option>
            {basics.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          {m.finance.tx.filters.category}
          <select name="categoria" defaultValue={category} className={selectClass}>
            <option value="">{m.finance.tx.filters.all}</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          {m.finance.tx.filters.kind}
          <select name="tipo" defaultValue={kind} className={selectClass}>
            <option value="">{m.finance.tx.filters.all}</option>
            <option value="income">{m.finance.tx.income}</option>
            <option value="expense">{m.finance.tx.expense}</option>
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-subtle">
          {m.finance.tx.filters.search}
          <input type="search" name="q" defaultValue={search} className={selectClass} />
        </label>
        <button type="submit" className={buttonClass("secondary", "h-10")}>{m.finance.tx.filters.apply}</button>
        <a href={`/financas/exportar?${exportParams.toString()}`} className={buttonClass("ghost", "h-10")}>
          {m.finance.tx.export}
        </a>
      </form>

      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-line px-5 py-4 text-sm sm:px-6">
          <span className="text-muted">{format(m.finance.tx.count, { count: transactions.length })}</span>
          {currencies.map((c) => {
            const income = incomeBy.get(c) ?? 0n;
            const expense = expenseBy.get(c) ?? 0n;
            return (
              <span key={c} className="tabular flex flex-wrap gap-x-4">
                <span><span className="text-subtle">{m.finance.tx.totalIn} </span>{fmt(income, c)}</span>
                <span><span className="text-subtle">{m.finance.tx.totalOut} </span>{fmt(expense, c)}</span>
                <span className="font-semibold"><span className="font-normal text-subtle">{m.finance.tx.net} </span>{fmt(income - expense, c)}</span>
              </span>
            );
          })}
        </div>
        <div className="px-5 py-3 sm:px-6">
          <TransactionList
            m={m}
            locale={locale}
            timeZone={scope.timezone}
            transactions={transactions}
            categories={categoriesMap}
            accounts={accountsMap}
            minorUnits={basics.minorUnits}
            today={today}
            installmentCounts={installmentCounts}
            attachments={{
              counts: attachmentCounts,
              href: (tx) => `/financas/movimentos?mes=${month}&${scope.canWrite ? "editar" : "anexos"}=${tx.id}`,
              label: (count) => format(m.finance.attachments.count, { count }),
            }}
            {...(scope.canWrite
              ? {
                  actions: (tx) => (
                    <div className="flex items-start gap-1">
                      <Link href={`/financas/movimentos?mes=${month}&editar=${tx.id}`} className={buttonClass("ghost", "h-9 px-3")}>
                        {m.finance.tx.edit.split(" ")[0]}
                      </Link>
                      <DeleteTransactionButton m={m} id={tx.id} />
                    </div>
                  ),
                }
              : {})}
          />
          {transactions.length === LIMIT ? <p className="py-3 text-xs text-subtle">{format(m.finance.tx.limited, { count: LIMIT })}</p> : null}
        </div>
      </section>
    </div>
  );
}

function sizeLabel(bytes: number, locale: string): string {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes >= 1024 * 1024 ? `${fmt.format(bytes / (1024 * 1024))} MB` : `${fmt.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
