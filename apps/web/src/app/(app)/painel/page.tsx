import type { Metadata } from "next";
import { format } from "@anen/i18n";
import { ActivityList } from "@/components/activity-list";
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

  const kpis = [m.dashboard.balance, m.dashboard.income, m.dashboard.expenses, m.dashboard.profit];
  const activeRoleName = active ? roleName(m, active.role) : null;

  return (
    <>
      <PageHeader
        title={format(m.dashboard.greeting, { name: firstName })}
        description={active ? active.organization.name : m.dashboard.contextPersonal}
      />

      <section aria-labelledby="kpis" className="flex flex-col gap-3">
        <h2 id="kpis" className="sr-only">
          {m.dashboard.title}
        </h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line xl:grid-cols-4">
          {kpis.map((label) => (
            <div key={label} className="flex flex-col gap-3 bg-surface p-5">
              <span className="text-sm text-muted">{label}</span>
              <span className="tabular text-2xl font-semibold text-subtle" aria-label="—">
                —
              </span>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-subtle">{m.dashboard.financeNotActive}</p>
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
