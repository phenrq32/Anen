import Link from "next/link";
import { format, formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { ProgressBar } from "@/components/finance-ui";
import { Badge, cx } from "@/components/ui";
import type { BusinessScope } from "@/lib/business";
import { sumByCurrency, todayIn, type FinanceScope } from "@/lib/finance";
import { projectFinancials } from "@/lib/projects";
import type { ServerClient } from "@/lib/supabase/server";

/** Indicadores de negócio do painel: valores em aberto e projetos em curso, a partir de dados reais. */
export async function BusinessOverview({
  m,
  locale,
  supabase,
  fin,
  biz,
  minorUnits,
  showOpen = true,
}: {
  m: Messages;
  locale: Locale;
  supabase: ServerClient;
  fin: FinanceScope;
  biz: BusinessScope;
  minorUnits: Map<string, number>;
  /** No "Hoje" da empresa os valores em aberto já aparecem no BusinessToday. */
  showOpen?: boolean;
}) {
  const today = todayIn(fin.timezone);
  const [openRes, projectsRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("kind, amount_minor, settled_minor, currency_code, due_on")
      .eq(fin.column, fin.value)
      .in("payment_status", ["pending", "partial"])
      .limit(2000),
    biz.canRead
      ? supabase.from("projects").select("*").eq(biz.column, biz.value).eq("status", "active").order("created_at", { ascending: false }).limit(4)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const open = openRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const { data: projectTx } = projects.length
    ? await supabase.from("transactions").select("*").in("project_id", projects.map((p) => p.id)).limit(5000)
    : { data: [] };
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);

  const side = (kind: "income" | "expense") => {
    const rows = open.filter((t) => t.kind === kind);
    return {
      totals: sumByCurrency(rows.map((t) => ({ currency: t.currency_code, amount: BigInt(t.amount_minor) - BigInt(t.settled_minor) }))),
      overdue: rows.filter((t) => t.due_on && t.due_on < today).length,
    };
  };
  const cards = [
    { key: "income" as const, label: m.dashboard.receivables, ...side("income") },
    { key: "expense" as const, label: m.dashboard.payables, ...side("expense") },
  ];

  return (
    <div className={cx("grid gap-6", showOpen ? "lg:grid-cols-[1fr_1fr]" : "")}>
      {showOpen ? (
      <Link href="/financas/em-aberto" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line transition-colors hover:border-graphite-soft">
        {cards.map((c) => (
          <div key={c.key} className="flex min-w-0 flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="flex items-center gap-2 text-sm text-muted">
              <span className={cx("size-2 rounded-full", c.key === "income" ? "bg-chart-income" : "bg-chart-expense")} aria-hidden />
              {c.label}
            </span>
            {c.totals.size === 0 ? (
              <span className="text-sm text-subtle">{m.dashboard.noOpen}</span>
            ) : (
              [...c.totals].map(([cur, v]) => (
                <span key={cur} className="tabular truncate text-xl font-semibold sm:text-2xl">{fmt(v, cur)}</span>
              ))
            )}
            {c.overdue > 0 ? <span className="text-xs text-danger">{format(m.dashboard.overdueCount, { count: c.overdue })}</span> : null}
          </div>
        ))}
      </Link>
      ) : null}
      {biz.canRead ? (
        <section className="rounded-xl border border-line bg-surface" aria-labelledby="dash-projects">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:px-6">
            <h2 id="dash-projects" className="text-base font-semibold">{m.dashboard.projectsTitle}</h2>
            <Link href="/projetos" className="text-sm text-muted hover:text-paper">{m.dashboard.seeProjects} →</Link>
          </div>
          {projects.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted sm:px-6">{m.dashboard.projectsEmpty}</p>
          ) : (
            <ul className="flex flex-col px-5 sm:px-6">
              {projects.map((p) => {
                const f = projectFinancials(p, (projectTx ?? []).filter((t) => t.project_id === p.id));
                return (
                  <li key={p.id} className="border-b border-line py-3 last:border-0">
                    <Link href={`/projetos/${p.id}`} className="flex flex-col gap-2">
                      <span className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium">{p.name}</span>
                        {f.overBudget ? <Badge tone="danger">{m.dashboard.overBudget}</Badge> : (
                          <span className="tabular shrink-0 text-xs text-muted">
                            {fmt(f.actualCost.amountMinor, p.currency_code)} / {fmt(f.plannedCost.amountMinor, p.currency_code)}
                          </span>
                        )}
                      </span>
                      {f.plannedCost.amountMinor > 0n ? (
                        <ProgressBar value={f.actualCost.amountMinor} max={f.plannedCost.amountMinor} over={f.overBudget} label={p.name} />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
