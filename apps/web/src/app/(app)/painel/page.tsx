import type { Metadata } from "next";
import { format } from "@anen/i18n";
import { ActivityList } from "@/components/activity-list";
import { MonthlyChart } from "@/components/charts";
import { EmptyFinance, FinanceKpis, TransactionList } from "@/components/finance-ui";
import { financeScope } from "@/lib/finance";
import { loadFinanceOverview } from "@/lib/finance-overview";
import { ButtonLink, PageHeader, Section } from "@/components/ui";
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

  let membersCount = 0;
  let pendingInvites: number | null = null;
  let audit: Awaited<ReturnType<typeof recentAudit>> = [];
  let names = new Map<string, string>();

  if (active) {
    const orgId = active.organization.id;
    const members = await supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active");
    membersCount = members.count ?? 0;
    if (can(active, "members.invite") || can(active, "members.manage")) {
      const invites = await supabase
        .from("organization_invitations")
        .select(INVITATION_COLUMNS, { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString());
      pendingInvites = invites.count ?? 0;
    }
    if (can(active, "audit.read")) {
      audit = await recentAudit(supabase, orgId, 8);
      names = await profileNames(supabase, audit.map((a) => a.actor_id).filter((x): x is string => Boolean(x)));
    }
  }

  const scope = financeScope(session);
  const finance = scope.canRead ? await loadFinanceOverview(supabase, scope, m, locale) : null;
  const activeRoleName = active ? roleName(m, active.role) : null;

  return (
    <>
      <PageHeader
        title={format(m.dashboard.greeting, { name: firstName })}
        description={active ? active.organization.name : m.dashboard.contextPersonal}
      />

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
              <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
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
              <p className="text-sm text-muted">{m.dashboard.quotesNotActive}</p>
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
