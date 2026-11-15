import type { Metadata } from "next";
import { ActivityList } from "@/components/activity-list";
import { PageHeader, Section } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { profileNames, recentAudit } from "@/lib/org-data";
import { loadReferenceData } from "@/lib/reference";
import { can, requireActiveOrganization } from "@/lib/session";
import { updateOrganizationAction } from "../actions";
import { OrganizationForm } from "../organizacoes/organization-form";

export const metadata: Metadata = { title: "Organização" };

export default async function OrganizationPage() {
  const { m, locale } = await getI18n();
  const session = await requireActiveOrganization();
  const { active, supabase } = session;
  const reference = await loadReferenceData(supabase);
  const audit = can(active, "audit.read") ? await recentAudit(supabase, active.organization.id, 25) : [];
  const names = await profileNames(supabase, audit.map((a) => a.actor_id).filter((x): x is string => Boolean(x)));

  return (
    <>
      <PageHeader title={active.organization.name} description={m.organization.kinds[active.organization.kind].label} />
      <Section title={m.organization.detailsTitle}>
        <OrganizationForm
          m={m}
          reference={reference}
          action={updateOrganizationAction}
          mode="edit"
          initial={active.organization}
          defaults={{ countryCode: active.organization.country_code, currencyCode: active.organization.currency_code, timezone: active.organization.timezone }}
          readOnly={!can(active, "organization.update")}
        />
      </Section>
      {can(active, "audit.read") ? (
        <Section title={m.audit.title}>
          <ActivityList m={m} locale={locale} timeZone={session.preferences.timezone} logs={audit} names={names} />
        </Section>
      ) : null}
    </>
  );
}
