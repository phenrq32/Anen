import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { loadReferenceData } from "@/lib/reference";
import { requireOnboardedSession } from "@/lib/session";
import { cookies } from "next/headers";
import { parseTextSize, parseTheme, TEXT_COOKIE, THEME_COOKIE } from "@/lib/appearance";
import { AppearancePicker } from "./appearance-picker";
import { A11yPicker } from "./a11y-picker";
import { A11Y_COOKIE, parseA11y } from "@/lib/a11y";
import { ModulesForm, PreferencesForm, ProfileForm } from "./settings-forms";

export const metadata: Metadata = { title: "Definições" };

export default async function SettingsPage() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const [reference, cookieStore] = await Promise.all([loadReferenceData(session.supabase), cookies()]);
  const p = session.preferences;
  return (
    <>
      <PageHeader title={m.settings.title} />
      <div id="aparencia" className="scroll-mt-24">
        <Section title={m.settings.appearance.title} description={m.settings.appearance.body}>
          <AppearancePicker
            m={m}
            theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
            text={parseTextSize(cookieStore.get(TEXT_COOKIE)?.value)}
          />
        </Section>
      </div>
      <div id="acessibilidade" className="scroll-mt-24">
        <Section title={m.settings.a11y.title} description={m.settings.a11y.body}>
          <A11yPicker m={m} initial={[...parseA11y(cookieStore.get(A11Y_COOKIE)?.value)]} />
        </Section>
      </div>
      <div id="areas" className="scroll-mt-24">
        <Section title={m.settings.modules.title} description={m.settings.modules.body}>
          <ModulesForm
            m={m}
            hidden={p.hidden_modules ?? []}
            labels={{
              orcamentos: m.nav.quotes,
              faturacao: m.nav.invoicing,
              projetos: m.nav.projects,
              compras: m.nav.purchases,
              inventario: m.nav.inventory,
              restauracao: m.nav.recipes,
              ia: m.nav.ai,
              inteligencia: m.nav.intelligence,
              relatorios: m.nav.reports,
              mercado: m.nav.market,
            }}
          />
        </Section>
      </div>
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
