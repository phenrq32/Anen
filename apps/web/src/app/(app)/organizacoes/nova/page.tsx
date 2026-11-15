import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { loadReferenceData } from "@/lib/reference";
import { requireOnboardedSession } from "@/lib/session";
import { createOrganizationAction } from "../../actions";
import { OrganizationForm } from "../organization-form";

export const metadata: Metadata = { title: "Nova organização" };

export default async function NewOrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const params = await searchParams;
  const reference = await loadReferenceData(session.supabase);
  const p = session.preferences;
  return (
    <>
      <PageHeader title={m.organization.newTitle} description={m.organization.newSubtitle} />
      <div className="max-w-3xl">
        <OrganizationForm
          m={m}
          reference={reference}
          action={createOrganizationAction}
          mode="create"
          defaultKind={params.tipo === "independent" ? "independent" : "business"}
          defaults={{ countryCode: p.country_code ?? "PT", currencyCode: p.currency_code, timezone: p.timezone }}
        />
      </div>
    </>
  );
}
