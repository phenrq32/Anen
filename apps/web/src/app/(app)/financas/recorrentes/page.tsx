import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { formatAmountInput } from "@anen/validation";
import { Badge, Section } from "@/components/ui";
import { businessScope, loadLinkOptions } from "@/lib/business";
import { categoryLabel, financeScope, loadFinanceBasics, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { RecurringActions, RecurringEditForm, RecurringForm } from "../finance-forms";

export const metadata: Metadata = { title: "Recorrentes" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function RecurringPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const params = await searchParams;
  const [basics, recurringRes, links] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    session.supabase.from("recurring_transactions").select("*").eq(scope.column, scope.value).order("next_run_on"),
    loadLinkOptions(session.supabase, businessScope(session)),
  ]);
  const categories = new Map(basics.categories.map((c) => [c.id, c]));
  const accounts = new Map(basics.accounts.map((a) => [a.id, a]));
  const contactNames = new Map(links.contacts.map((c) => [c.id, c.name]));
  const projectNames = new Map(links.projects.map((p) => [p.id, p.name]));
  const items = recurringRes.data ?? [];
  const categoryOptions = basics.categories.map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }));
  const editing = scope.canWrite && params.editar && UUID.test(params.editar) ? items.find((r) => r.id === params.editar) : undefined;

  return (
    <div className="flex flex-col gap-6">
      {editing ? (
        <Section title={`${m.finance.recurring.editTitle} · ${editing.description}`}>
          <RecurringEditForm
            key={editing.id}
            m={m}
            categories={categoryOptions}
            links={links}
            initial={{
              id: editing.id,
              kind: editing.kind,
              amount: formatAmountInput(BigInt(editing.amount_minor), basics.minorUnits.get(editing.currency_code) ?? 2),
              currency: editing.currency_code,
              categoryId: editing.category_id,
              description: editing.description,
              endOn: editing.end_on,
              contactId: editing.contact_id,
              projectId: editing.project_id,
              costCenterId: editing.cost_center_id,
              costKind: editing.cost_kind,
              generatePending: editing.generate_pending,
              dueDays: editing.due_days,
            }}
          />
          <Link href="/financas/recorrentes" className="mt-3 inline-block text-sm text-muted hover:text-paper">
            {m.common.cancel}
          </Link>
        </Section>
      ) : null}

      <Section title={m.finance.recurring.title} description={m.finance.recurring.note}>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{m.finance.recurring.empty}</p>
        ) : (
          <ul className="-my-3 flex flex-col">
            {items.map((r) => {
              const extras = [
                r.contact_id ? contactNames.get(r.contact_id) : null,
                r.project_id ? projectNames.get(r.project_id) : null,
                r.due_days !== null ? `${m.finance.tx.dueOn} +${r.due_days}d` : null,
              ].filter(Boolean);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line py-4 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {r.description}
                      <Badge tone={r.is_active ? "brand" : "neutral"}>{r.is_active ? m.finance.recurring.active : m.finance.recurring.paused}</Badge>
                      {r.generate_pending ? <Badge>{m.finance.tx.pendingBadge}</Badge> : null}
                    </p>
                    <p className="text-xs text-subtle">
                      {m.finance.recurring.frequencies[r.frequency]}
                      {r.interval_count > 1 ? ` ×${r.interval_count}` : ""} · {categoryLabel(m, r.category_id ? categories.get(r.category_id) : undefined)} ·{" "}
                      {accounts.get(r.account_id)?.name ?? ""} · {format(m.finance.recurring.next, { date: formatDate(r.next_run_on, locale, "UTC") })}
                      {extras.length ? ` · ${extras.join(" · ")}` : ""}
                    </p>
                  </div>
                  <span className="tabular font-semibold">
                    {r.kind === "income" ? "+" : "−"}
                    {formatMoney(BigInt(r.amount_minor), r.currency_code, basics.minorUnits.get(r.currency_code) ?? 2, locale)}
                  </span>
                  {scope.canWrite ? <RecurringActions m={m} id={r.id} active={r.is_active} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {scope.canWrite && basics.accounts.some((a) => !a.archived_at) ? (
        <Section title={m.finance.recurring.new}>
          <RecurringForm
            m={m}
            accounts={basics.accounts.filter((a) => !a.archived_at).map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
            categories={categoryOptions}
            today={todayIn(scope.timezone)}
            links={links}
          />
        </Section>
      ) : null}
    </div>
  );
}
