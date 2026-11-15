import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { loadReferenceData } from "@/lib/reference";
import { requireOnboardedSession } from "@/lib/session";
import { PreferencesForm, ProfileForm } from "./settings-forms";

export const metadata: Metadata = { title: "Definições" };

export default async function SettingsPage() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const reference = await loadReferenceData(session.supabase);
  const p = session.preferences;
  return (
    <>
      <PageHeader title={m.settings.title} />
      <Section title={m.settings.profileTitle}>
        <ProfileForm m={m} fullName={session.profile.full_name ?? ""} email={session.user.email} />
      </Section>
      <Section title={m.settings.preferencesTitle} description={m.settings.preferencesBody}>
        <PreferencesForm
          m={m}
          reference={reference}
          defaults={{ countryCode: p.country_code ?? "PT", languageCode: p.language_code, currencyCode: p.currency_code, timezone: p.timezone }}
        />
      </Section>
    </>
  );
}
