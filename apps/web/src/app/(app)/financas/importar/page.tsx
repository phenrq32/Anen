import type { Metadata } from "next";
import { Alert, Section } from "@/components/ui";
import { categoryLabel, financeScope, loadFinanceBasics } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar extrato" };

export default async function ImportPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canWrite) return <Alert tone="info">{m.errors.forbidden}</Alert>;
  const basics = await loadFinanceBasics(session.supabase, scope);
  const accounts = basics.accounts
    .filter((a) => !a.archived_at)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency_code, minorUnit: basics.minorUnits.get(a.currency_code) ?? 2 }));
  const categories = basics.categories.filter((c) => !c.archived_at).map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }));
  return (
    <Section title={m.import.title} description={m.import.description}>
      <ImportWizard m={m} locale={locale} accounts={accounts} categories={categories} />
    </Section>
  );
}
