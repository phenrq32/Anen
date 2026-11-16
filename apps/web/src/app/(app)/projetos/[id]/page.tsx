import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatMoney } from "@anen/i18n";
import { formatAmountInput } from "@anen/validation";
import { ProgressBar, TransactionList } from "@/components/finance-ui";
import { Alert, Badge, Section, buttonClass, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope, loadFinanceBasics, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { formatPercent, projectFinancials } from "@/lib/projects";
import { loadReferenceData } from "@/lib/reference";
import { requireOnboardedSession } from "@/lib/session";
import { DeleteProjectButton, ProjectForm } from "../project-form";

export const metadata: Metadata = { title: "Projeto" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const fin = financeScope(session);
  const t = m.business.projects;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!scope.canRead) return <Alert tone="info">{t.noPermission}</Alert>;

  const { data: project } = await session.supabase.from("projects").select("*").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  if (!project) notFound();

  const [txRes, quoteRes, itemsRes, clientsRes, reference, basics] = await Promise.all([
    fin.canRead
      ? session.supabase.from("transactions").select("*").eq("project_id", id).order("occurred_on", { ascending: false }).limit(2000)
      : Promise.resolve({ data: [], error: null }),
    project.quote_id ? session.supabase.from("quotes").select("id, number, title").eq("id", project.quote_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    project.quote_id
      ? session.supabase.from("quote_items").select("kind, total_cost_minor").eq("quote_id", project.quote_id)
      : Promise.resolve({ data: [], error: null }),
    session.supabase.from("contacts").select("id, name, kind").eq(scope.column, scope.value).order("name"),
    loadReferenceData(session.supabase),
    fin.canRead ? loadFinanceBasics(session.supabase, fin) : Promise.resolve(null),
  ]);
  const transactions = txRes.data ?? [];
  const f = projectFinancials(project, transactions, itemsRes.data ?? []);
  const minorUnit = reference.currencies.find((c) => c.code === project.currency_code)?.minor_unit ?? 2;
  const fmt = (v: bigint) => formatMoney(v, project.currency_code, minorUnit, locale);
  const pct = (d: Parameters<typeof formatPercent>[0]) => formatPercent(d, locale) ?? "—";
  const clients = (clientsRes.data ?? []).filter((c) => c.kind !== "supplier" || c.id === project.client_contact_id);
  const client = clients.find((c) => c.id === project.client_contact_id);
  const today = todayIn(fin.timezone);

  const tiles = [
    { label: t.kpi.plannedCost, value: fmt(f.plannedCost.amountMinor), note: null },
    {
      label: t.kpi.actualCost,
      value: fmt(f.actualCost.amountMinor),
      note: f.unpaidCost.amountMinor > 0n ? `${t.kpi.unpaid}: ${fmt(f.unpaidCost.amountMinor)}` : null,
      tone: f.overBudget ? "danger" : undefined,
    },
    {
      label: t.kpi.variance,
      value: `${f.costVariance.amountMinor > 0n ? "+" : ""}${fmt(f.costVariance.amountMinor)}`,
      note: f.costVariancePercent ? pct(f.costVariancePercent) : null,
      tone: f.costVariance.amountMinor > 0n ? "danger" : undefined,
    },
    { label: t.kpi.plannedRevenue, value: fmt(f.plannedRevenue.amountMinor), note: null },
    {
      label: t.kpi.invoiced,
      value: fmt(f.invoicedRevenue.amountMinor),
      note: `${t.kpi.received}: ${fmt(f.receivedRevenue.amountMinor)}${f.outstandingRevenue.amountMinor > 0n ? ` · ${t.kpi.outstanding}: ${fmt(f.outstandingRevenue.amountMinor)}` : ""}`,
    },
    {
      label: t.kpi.actualProfit,
      value: fmt(f.actualProfit.amountMinor),
      note: `${t.kpi.actualMargin}: ${pct(f.actualMarginPercent)} · ${t.kpi.plannedProfit}: ${fmt(f.plannedProfit.amountMinor)} (${pct(f.plannedMarginPercent)})`,
      tone: f.actualProfit.amountMinor < 0n ? "danger" : f.actualProfit.amountMinor > 0n ? "brand" : undefined,
    },
  ];

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Link href="/projetos" className="text-sm text-muted hover:text-paper">← {t.title}</Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-[28px]">
            {project.name}
            <Badge tone={project.status === "active" ? "brand" : "neutral"}>{t.statuses[project.status]}</Badge>
          </h1>
          <p className="flex flex-wrap gap-x-3 text-sm text-subtle">
            {client ? <Link href={`/contactos/${client.id}`} className="hover:text-paper">{client.name}</Link> : <span>{t.noClient}</span>}
            {quoteRes.data ? (
              <Link href={`/orcamentos/${quoteRes.data.id}`} className="hover:text-paper">
                {t.fromQuote}: {quoteRes.data.number}
              </Link>
            ) : null}
            <span>{project.currency_code}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {fin.canWrite ? (
            <Link href={`/financas/movimentos?projeto=${project.id}`} className={buttonClass("primary")}>
              {t.addMovement}
            </Link>
          ) : null}
          {scope.canWrite ? <DeleteProjectButton m={m} id={project.id} /> : null}
        </div>
      </header>

      {!fin.canRead ? <Alert tone="info">{t.noFinanceAccess}</Alert> : null}
      {f.overBudget ? (
        <Alert tone="error">{format(t.overBudget, { amount: fmt(f.costVariance.amountMinor), percent: pct(f.costVariancePercent).replace(" %", "") })}</Alert>
      ) : null}

      {fin.canRead ? (
        <>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {tiles.map((k) => (
              <div key={k.label} className="flex min-w-0 flex-col gap-1.5 bg-surface p-4 sm:p-5">
                <span className="text-sm text-muted">{k.label}</span>
                <span className={cx("tabular truncate text-xl font-semibold sm:text-2xl", k.tone === "danger" && "text-danger", k.tone === "brand" && "text-brand")}>{k.value}</span>
                {k.note ? <span className="text-xs text-subtle">{k.note}</span> : null}
              </div>
            ))}
          </div>
          {f.plannedCost.amountMinor > 0n ? (
            <div className="flex flex-col gap-2">
              <ProgressBar
                value={f.actualCost.amountMinor}
                max={f.plannedCost.amountMinor}
                over={f.overBudget}
                label={format(t.kpi.budgetUsed, { percent: pct(f.budgetUsedPercent).replace(" %", "") })}
              />
              <p className="tabular text-xs text-subtle">{format(t.kpi.budgetUsed, { percent: pct(f.budgetUsedPercent).replace(" %", "") })}</p>
            </div>
          ) : null}

          <Section title={t.byKindTitle} description={t.byKindHint}>
            {f.byKind.length === 0 ? (
              <p className="text-sm text-muted">—</p>
            ) : (
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-subtle">
                      <th scope="col" className="px-5 py-2 font-medium sm:px-0">{t.kind}</th>
                      <th scope="col" className="py-2 text-right font-medium">{t.planned}</th>
                      <th scope="col" className="py-2 text-right font-medium">{t.actual}</th>
                      <th scope="col" className="px-5 py-2 text-right font-medium sm:px-0">{t.variance}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.byKind.map((k) => (
                      <tr key={k.kind} className="border-b border-line last:border-0">
                        <th scope="row" className="px-5 py-2.5 text-left font-normal sm:px-0">
                          {k.kind === "unclassified" ? t.unclassified : m.quotes.line.kinds[k.kind]}
                        </th>
                        <td className="tabular py-2.5 text-right text-muted">{fmt(k.planned.amountMinor)}</td>
                        <td className="tabular py-2.5 text-right">{fmt(k.actual.amountMinor)}</td>
                        <td className={cx("tabular px-5 py-2.5 text-right font-medium sm:px-0", k.variance.amountMinor > 0n && k.planned.amountMinor > 0n ? "text-danger" : "text-muted")}>
                          {k.variance.amountMinor > 0n ? "+" : ""}
                          {fmt(k.variance.amountMinor)}
                          {k.variancePercent ? <span className="ml-1.5 text-xs font-normal">({pct(k.variancePercent)})</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={t.movementsTitle}>
            {transactions.length === 0 || !basics ? (
              <p className="text-sm text-muted">{t.noMovements}</p>
            ) : (
              <TransactionList
                m={m}
                locale={locale}
                timeZone={fin.timezone}
                transactions={transactions}
                categories={new Map(basics.categories.map((c) => [c.id, c]))}
                accounts={new Map(basics.accounts.map((a) => [a.id, a]))}
                minorUnits={basics.minorUnits}
                today={today}
              />
            )}
          </Section>

          <details className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-muted sm:px-6">
            <summary className="cursor-pointer font-medium text-paper">{t.method}</summary>
            <p className="mt-2 max-w-3xl">{t.methodBody}</p>
          </details>
        </>
      ) : null}

      {scope.canWrite ? (
        <Section title={t.edit}>
          <ProjectForm
            m={m}
            clients={clients}
            currencies={reference.currencies}
            defaultCurrency={project.currency_code}
            initial={{
              id: project.id,
              name: project.name,
              clientContactId: project.client_contact_id,
              status: project.status,
              currencyCode: project.currency_code,
              plannedCost: formatAmountInput(BigInt(project.planned_cost_minor), minorUnit),
              plannedRevenue: formatAmountInput(BigInt(project.planned_revenue_minor), minorUnit),
              startOn: project.start_on,
              endOn: project.end_on,
              notes: project.notes,
              currencyLocked: transactions.length > 0,
            }}
          />
        </Section>
      ) : null}
    </>
  );
}
