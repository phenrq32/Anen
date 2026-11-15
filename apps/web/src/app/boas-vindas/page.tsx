import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfigMissing } from "@/components/config-missing";
import { Logo } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { loadReferenceData } from "@/lib/reference";
import { requireSession } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Boas-vindas" };

export default async function OnboardingPage() {
  const { m } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  const session = await requireSession();
  if (session.profile.onboarded_at) redirect("/painel");
  const reference = await loadReferenceData(session.supabase);
  const p = session.preferences;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10 sm:py-16">
      <Logo className="h-7 w-auto self-start" />
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold">{m.onboarding.title}</h1>
        <p className="text-muted">{m.onboarding.subtitle}</p>
      </header>
      <OnboardingForm
        m={m}
        reference={reference}
        defaults={{
          fullName: session.profile.full_name ?? "",
          accountType: session.profile.primary_account_type,
          countryCode: p.country_code ?? "PT",
          languageCode: p.language_code,
          currencyCode: p.currency_code,
          timezone: p.timezone,
        }}
      />
    </main>
  );
}
