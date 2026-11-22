import type { Metadata } from "next";
import Link from "next/link";
import { financialHealth } from "@anen/financial-engine";
import { format, formatMoney } from "@anen/i18n";
import { ActivityList } from "@/components/activity-list";
import { BusinessOverview } from "@/components/business-overview";
import { MonthlyChart } from "@/components/charts";
import { EmptyFinance, FinanceKpis, TransactionList } from "@/components/finance-ui";
import { businessScope } from "@/lib/business";
import { financeScope } from "@/lib/finance";
import { quotesScope } from "@/lib/quotes";
import { statusTone } from "../orcamentos/status";
import { loadFinanceOverview } from "@/lib/finance-overview";
import { Badge, ButtonLink, Section, cx } from "@/components/ui";
import { ScoreRing } from "@/components/motion";
import { NavIcon } from "@/components/nav-links";
import { loadIntelligence } from "@/lib/intelligence";
import { formatPercent } from "@/lib/projects";
import { QuickAddTile } from "./quick-tile";
import { roleName } from "@/lib/errors";
import { getI18n } from "@/lib/i18n";
import { INVITATION_COLUMNS, profileNames, recentAudit } from "@/lib/org-data";
import { can, requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Painel" };

export default async function DashboardPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const { active, supabase } = session;
  const firstName = (session.profile.full_name ?? "").split(" ")[0] || session.user.email;

  const scope = financeScope(session);
  const biz = businessScope(session);
  const qScope = quotesScope(session);
  const orgId = active?.organization.id ?? null;
  const canInvites = Boolean(active && (can(active, "members.invite") || can(active, "members.manage")));
  const canAudit = Boolean(active && can(active, "audit.read"));

  // Tudo em paralelo: cada consulta é uma ida à base de dados; em série somavam-se.
  const [members, invites, audit, finance, quotesRes, intel] = await Promise.all([
    orgId
      ? supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    orgId && canInvites
      ? supabase
          .from("organization_invitations")
          .select(INVITATION_COLUMNS, { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
      : Promise.resolve({ count: null }),
    orgId && canAudit ? recentAudit(supabase, orgId, 8) : Promise.resolve([] as Awaited<ReturnType<typeof recentAudit>>),
    scope.canRead ? loadFinanceOverview(supabase, scope, m, locale) : Promise.resolve(null),
    qScope.canRead
      ? supabase.from("quotes").select("id, number, title, status, total_minor, currency_code").eq(qScope.column, qScope.value).order("created_at", { ascending: false }).limit(4)
      : Promise.resolve({ data: [] }),
    loadIntelligence(session, m, "month").catch(() => null),
  ]);
  const membersCount = members.count ?? 0;
  const pendingInvites: number | null = canInvites ? (invites.count ?? 0) : null;
  const names = audit.length ? await profileNames(supabase, audit.map((x) => x.actor_id).filter((x): x is string => Boolean(x))) : new Map<string, string>();
  const recentQuotes = quotesRes.data;
  const activeRoleName = active ? roleName(m, active.role) : null;

  // Saudação pela hora local da pessoa.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: session.preferences.timezone }).format(new Date()));
  const greeting = hour < 12 ? m.dashboard.morning : hour < 19 ? m.dashboard.afternoon : m.dashboard.evening;
  const todayLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: session.preferences.timezone }).format(new Date());

  // Nota de saúde financeira (motor determinístico) na moeda apresentada no painel.
  let health: ReturnType<typeof financialHealth> = null;
  if (finance && finance.basics.accounts.length > 0) {
    const previous = finance.monthly.slice(5, 11).map((x) => BigInt(x.expense)).filter((v) => v > 0n);
    const avg = previous.length ? previous.reduce((x, y) => x + y, 0n) / BigInt(previous.length) : 0n;
    const overdue = (intel?.recommendations ?? [])
      .filter((r) => r.kind === "overdue_payables" && r.impact?.currency === finance.currency)
      .reduce((n, r) => n + r.count, 0);
    health = financialHealth({ income: finance.income, expense: finance.expense, balance: finance.balance, averageMonthlyExpense: avg, overdueCount: overdue });
  }
  const top = (intel?.recommendations ?? []).filter((r) => r.kind !== "no_movements").slice(0, 3);
  const h = m.dashboard.health;
  const money = (v: { amountMinor: bigint; currency: string }) => formatMoney(v.amountMinor, v.currency, intel?.minorUnits.get(v.currency) ?? 2, locale);
  const recText = (r: (typeof top)[number]) => {
    const subject =
      r.kind === "expense_increase" ? (r.subject ? (intel?.categoryNames.get(r.subject) ?? m.reports.none.category) : m.reports.none.category) : (r.subject ?? "");
    const pct = r.percent ? (formatPercent(r.percent.coefficient < 0n ? { ...r.percent, coefficient: -r.percent.coefficient } : r.percent, locale) ?? "") : "";
    const vars = { impact: r.impact ? money(r.impact) : "", count: r.count, subject, percent: pct, before: r.before ? money(r.before) : "", after: r.after ? money(r.after) : "" };
    const k = m.intelligence.kinds[r.kind];
    return { title: format(k.title, vars), body: format(k.body, vars), action: k.action };
  };
  const quick = [
    { href: null as string | null, label: m.dashboard.quick.register, hint: m.dashboard.quick.registerHint, icon: "plus" as const, show: scope.canWrite },
    { href: "/orcamentos/novo", label: m.dashboard.quick.quote, hint: m.dashboard.quick.quoteHint, icon: "file" as const, show: qScope.canWrite },
    { href: "/ia", label: m.dashboard.quick.ask, hint: m.dashboard.quick.askHint, icon: "spark" as const, show: true },
    { href: "/inteligencia", label: m.dashboard.quick.insights, hint: m.dashboard.quick.insightsHint, icon: "bulb" as const, show: true },
  ].filter((q) => q.show);

  return (
    <>
      <section className="shine relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-[#1a1410] via-surface to-surface p-5 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="block text-sm text-muted first-letter:uppercase">{todayLabel}</span>
            <h1 className="break-words text-[30px] font-extrabold leading-tight tracking-tight sm:text-[40px]">{format(greeting, { name: firstName })}</h1>
            <p className="text-[15px] text-muted">{active ? active.organization.name : m.dashboard.contextPersonal}</p>
          </div>
          {health ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ScoreRing score={health.score} label={h.title} sublabel={h.outOf} tone={health.band} />
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">{h.title}</span>
                <span className="font-heading text-xl font-bold">{h.bands[health.band]}</span>
                <ul className="flex flex-col gap-1 text-muted">
                  <li>
                    <span className="tabular text-paper">{health.parts.savings.points}/40</span> · {h.savings}:{" "}
                    {health.parts.savings.ratePercent === null ? h.savingsNone : format(h.savingsValue, { rate: health.parts.savings.ratePercent })}
                  </li>
                  <li>
                    <span className="tabular text-paper">{health.parts.reserve.points}/30</span> · {h.reserve}:{" "}
                    {health.parts.reserve.months === null
                      ? h.reserveNone
                      : format(h.reserveValue, { months: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(health.parts.reserve.months) })}
                  </li>
                  <li>
                    <span className="tabular text-paper">{health.parts.onTime.points}/30</span> · {h.onTime}:{" "}
                    {health.parts.onTime.overdue === 0 ? h.onTimeOk : format(h.onTimeValue, { count: health.parts.onTime.overdue })}
                  </li>
                </ul>
                <details className="text-xs text-subtle">
                  <summary className="cursor-pointer select-none hover:text-paper">{h.how}</summary>
                  <p className="mt-1 max-w-xs leading-relaxed">{h.explain}</p>
                </details>
              </div>
            </div>
          ) : finance ? (
            <p className="max-w-xs text-sm text-muted">{h.empty}</p>
          ) : null}
        </div>
      </section>

      <section aria-label={m.dashboard.quick.title} className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{m.dashboard.quick.title}</h2>
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          {quick.map((q) =>
            q.href ? (
              <Link key={q.label} href={q.href} className="lift group flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-line bg-surface/80 p-4">
                <span className="grid size-11 place-items-center rounded-xl bg-graphite text-brand transition-all duration-300 group-hover:scale-110 group-hover:bg-brand group-hover:text-ink">
                  <NavIcon name={q.icon} className="size-5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{q.label}</span>
                  <span className="text-xs text-subtle">{q.hint}</span>
                </span>
              </Link>
            ) : (
              <QuickAddTile key={q.label} label={q.label} hint={q.hint} fallbackHref="/financas/contas" />
            ),
          )}
        </div>
      </section>

      {intel ? (
        <section aria-label={m.dashboard.today} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{m.dashboard.today}</h2>
            <Link href="/inteligencia?periodo=month" className="text-sm text-brand hover:underline">{m.dashboard.seeAll} →</Link>
          </div>
          {top.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface/80 px-4 py-4 text-[15px] text-muted">{m.dashboard.todayEmpty}</p>
          ) : (
            <ul className="stagger grid gap-3 md:grid-cols-3">
              {top.map((r, i) => {
                const t = recText(r);
                return (
                  <li key={`${r.kind}-${i}`}>
                    <Link
                      href={r.href}
                      className={cx("lift flex h-full flex-col gap-2 rounded-2xl border bg-surface/80 p-4", r.severity === "high" ? "border-danger/30" : "border-line")}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                        <span className={cx("size-2 rounded-full", r.severity === "high" ? "animate-pulse bg-danger" : r.severity === "medium" ? "bg-brand" : "bg-subtle")} aria-hidden />
                        <span className={r.severity === "high" ? "text-danger" : "text-subtle"}>{m.intelligence.severity[r.severity]}</span>
                      </span>
                      <span className="font-semibold">{t.title}</span>
                      <span className="line-clamp-3 text-sm text-muted">{t.body}</span>
                      <span className="mt-auto pt-1 text-sm font-medium text-brand">{t.action} →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="kpis" className="flex flex-col gap-4">
        <h2 id="kpis" className="sr-only">
          {m.finance.title}
        </h2>
        {!finance ? (
          <p className="text-sm text-muted">{m.finance.noPermission}</p>
        ) : finance.basics.accounts.length === 0 ? (
          <EmptyFinance m={m} canWrite={scope.canWrite} />
        ) : (
          <>
            <FinanceKpis
              m={m}
              locale={locale}
              currency={finance.currency}
              minorUnit={finance.minorUnit}
              balance={finance.balance}
              income={finance.income}
              expense={finance.expense}
              prevIncome={finance.prevIncome}
              prevExpense={finance.prevExpense}
            />
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="rounded-2xl border border-line bg-surface/80 p-5 sm:p-6">
                <MonthlyChart
                  data={finance.monthly}
                  currency={finance.currency}
                  minorUnit={finance.minorUnit}
                  locale={locale}
                  labels={{
                    title: m.finance.chart.monthlyTitle,
                    subtitle: format(m.finance.chart.monthlySubtitle, { currency: finance.currency }),
                    income: m.finance.chart.income,
                    expense: m.finance.chart.expense,
                    result: m.finance.chart.result,
                    month: m.finance.chart.month,
                    showTable: m.finance.chart.showTable,
                    showChart: m.finance.chart.showChart,
                  }}
                />
              </div>
              <Section title={m.finance.recentTitle}>
                <TransactionList
                  m={m}
                  locale={locale}
                  timeZone={scope.timezone}
                  transactions={finance.recent.slice(0, 5)}
                  categories={new Map(finance.basics.categories.map((c) => [c.id, c]))}
                  accounts={new Map(finance.basics.accounts.map((a) => [a.id, a]))}
                  minorUnits={finance.basics.minorUnits}
                />
                <ButtonLink href="/financas" variant="ghost" className="mt-3 -ml-3">
                  {m.finance.seeAll} →
                </ButtonLink>
              </Section>
            </div>
            <BusinessOverview m={m} locale={locale} supabase={supabase} fin={scope} biz={biz} minorUnits={finance.basics.minorUnits} />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {active ? (
            <Section title={m.audit.title}>
              {can(active, "audit.read") ? (
                <ActivityList m={m} locale={locale} timeZone={session.preferences.timezone} logs={audit} names={names} />
              ) : (
                <p className="text-sm text-muted">{m.errors.forbidden}</p>
              )}
            </Section>
          ) : (
            <Section title={m.dashboard.contextPersonal}>
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-muted">{m.dashboard.personalBody}</p>
                <ButtonLink href="/organizacoes/nova">{m.nav.newOrganization}</ButtonLink>
              </div>
            </Section>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <Section title={m.dashboard.quotesTitle}>
              {!qScope.canRead ? (
                <p className="text-sm text-muted">{m.errors.forbidden}</p>
              ) : (recentQuotes ?? []).length === 0 ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted">{m.quotes.empty}</p>
                  {qScope.canWrite ? <ButtonLink href="/orcamentos/novo" variant="secondary">{m.quotes.new}</ButtonLink> : null}
                </div>
              ) : (
                <ul className="-my-2 flex flex-col">
                  {(recentQuotes ?? []).map((q) => (
                    <li key={q.id} className="border-b border-line py-2.5 last:border-0">
                      <Link href={`/orcamentos/${q.id}`} className="flex items-center gap-3 text-sm hover:text-brand">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{q.title}</span>
                          <span className="tabular block text-xs text-subtle">
                            {q.number} · {formatMoney(BigInt(q.total_minor), q.currency_code, finance?.basics.minorUnits.get(q.currency_code) ?? 2, locale)}
                          </span>
                        </span>
                        <Badge tone={statusTone(q.status)}>{m.quotes.statuses[q.status]}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={m.dashboard.requestsTitle}>
              <p className="text-sm text-muted">{m.dashboard.requestsNotActive}</p>
            </Section>
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          {active ? (
            <Section title={m.dashboard.organizationTitle}>
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{m.members.title}</dt>
                  <dd className="tabular">{format(m.dashboard.membersCount, { count: membersCount })}</dd>
                </div>
                {pendingInvites !== null ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{m.members.pendingTitle}</dt>
                    <dd className="tabular">{format(m.dashboard.pendingInvites, { count: pendingInvites })}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{m.members.role}</dt>
                  <dd>{activeRoleName}</dd>
                </div>
              </dl>
            </Section>
          ) : null}
          <Section title={m.dashboard.shortcuts}>
            <div className="flex flex-col gap-2">
              {active && can(active, "members.invite") ? (
                <ButtonLink href="/organizacao/membros" variant="secondary" className="justify-start">
                  {m.members.inviteTitle}
                </ButtonLink>
              ) : null}
              <ButtonLink href="/organizacoes/nova" variant="secondary" className="justify-start">
                {m.nav.newOrganization}
              </ButtonLink>
              <ButtonLink href="/definicoes" variant="secondary" className="justify-start">
                {m.nav.settings}
              </ButtonLink>
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}
