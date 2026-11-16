import type { Metadata } from "next";
import Link from "next/link";
import { format, formatMoney } from "@anen/i18n";
import type { FinanceTransaction } from "@anen/types";
import { ProgressBar } from "@/components/finance-ui";
import { Alert, Badge, PageHeader, Section, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { formatPercent, projectFinancials } from "@/lib/projects";
import { loadReferenceData } from "@/lib/reference";
import { requireOnboardedSession } from "@/lib/session";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const fin = financeScope(session);
  const t = m.business.projects;
  if (!scope.canRead) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const showClosed = params.estado === "fechados";

  const [projectsRes, clientsRes, reference] = await Promise.all([
    session.supabase
      .from("projects")
      .select("*")
      .eq(scope.column, scope.value)
      .in("status", showClosed ? ["completed", "cancelled"] : ["planned", "active"])
      .order("created_at", { ascending: false })
      .limit(200),
    session.supabase.from("contacts").select("id, name, kind").eq(scope.column, scope.value).is("archived_at", null).order("name"),
    loadReferenceData(session.supabase),
  ]);
  if (projectsRes.error) throw new Error("Falha ao carregar projetos");
  const projects = projectsRes.data ?? [];
  const clients = (clientsRes.data ?? []).filter((c) => c.kind !== "supplier");
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const minorUnits = new Map(reference.currencies.map((c) => [c.code, c.minor_unit]));

  let movements: FinanceTransaction[] = [];
  if (fin.canRead && projects.length > 0) {
    const { data } = await session.supabase
      .from("transactions")
      .select("*")
      .in("project_id", projects.map((p) => p.id))
      .limit(5000);
    movements = data ?? [];
  }
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {scope.canWrite ? (
        <details className="group rounded-xl border border-line bg-surface">
          <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-5 text-base font-semibold sm:px-6">
            {t.new}
            <span className="text-2xl leading-none text-brand transition-transform group-open:rotate-45" aria-hidden>+</span>
          </summary>
          <div className="border-t border-line px-5 py-5 sm:px-6">
            <ProjectForm m={m} clients={clients} currencies={reference.currencies} defaultCurrency={scope.defaultCurrency} />
          </div>
        </details>
      ) : null}

      <div className="flex gap-2">
        <Link href="/projetos" className={chip(!showClosed)}>{`${t.statuses.planned} · ${t.statuses.active}`}</Link>
        <Link href="/projetos?estado=fechados" className={chip(showClosed)}>{`${t.statuses.completed} · ${t.statuses.cancelled}`}</Link>
      </div>

      {projects.length === 0 ? (
        <Section title={t.title}>
          <p className="text-sm text-muted">{t.empty}</p>
        </Section>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const f = projectFinancials(p, movements.filter((x) => x.project_id === p.id));
            return (
              <li key={p.id}>
                <Link
                  href={`/projetos/${p.id}`}
                  className={cx(
                    "flex h-full flex-col gap-4 rounded-xl border bg-surface p-5 transition-colors hover:border-graphite-soft",
                    f.overBudget ? "border-danger/40" : "border-line",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="truncate text-xs text-subtle">{(p.client_contact_id && clientNames.get(p.client_contact_id)) || t.noClient}</p>
                    </div>
                    {f.overBudget ? <Badge tone="danger">{m.dashboard.overBudget}</Badge> : <Badge tone={p.status === "active" ? "brand" : "neutral"}>{t.statuses[p.status]}</Badge>}
                  </div>
                  {fin.canRead ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-subtle">{t.kpi.actualCost}</p>
                          <p className={cx("tabular font-semibold", f.overBudget && "text-danger")}>{fmt(f.actualCost.amountMinor, p.currency_code)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-subtle">{t.kpi.plannedCost}</p>
                          <p className="tabular text-muted">{fmt(f.plannedCost.amountMinor, p.currency_code)}</p>
                        </div>
                      </div>
                      {f.plannedCost.amountMinor > 0n ? (
                        <ProgressBar
                          value={f.actualCost.amountMinor}
                          max={f.plannedCost.amountMinor}
                          over={f.overBudget}
                          label={format(t.kpi.budgetUsed, { percent: formatPercent(f.budgetUsedPercent, locale, 0)?.replace(" %", "") ?? "0" })}
                        />
                      ) : null}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-subtle">{t.kpi.actualProfit}</span>
                        <span className={cx("tabular font-medium", f.actualProfit.amountMinor < 0n ? "text-danger" : "text-paper")}>
                          {fmt(f.actualProfit.amountMinor, p.currency_code)}
                          {f.actualMarginPercent ? ` · ${formatPercent(f.actualMarginPercent, locale)}` : ""}
                        </span>
                      </div>
                    </>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
