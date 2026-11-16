import type { Metadata } from "next";
import { Alert, Section } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ArchiveCostCenterButton, CostCenterForm } from "../finance-forms";

export const metadata: Metadata = { title: "Centros de custo" };

export default async function CostCentersPage() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canRead) return <Alert tone="info">{m.business.contacts.noPermission}</Alert>;
  const { data, error } = await session.supabase
    .from("cost_centers")
    .select("id, name")
    .eq(scope.column, scope.value)
    .is("archived_at", null)
    .order("name");
  if (error) throw new Error("Falha ao carregar centros de custo");
  const centers = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">{m.finance.costCenters.hint}</p>
      {scope.canWrite ? (
        <Section title={m.finance.costCenters.new}>
          <CostCenterForm m={m} />
        </Section>
      ) : null}
      <Section title={m.finance.costCenters.title}>
        {centers.length === 0 ? (
          <p className="text-sm text-muted">{m.finance.costCenters.empty}</p>
        ) : (
          <ul className="-my-2 flex flex-col">
            {centers.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                <span className="flex-1 text-sm">{c.name}</span>
                {scope.canWrite ? <ArchiveCostCenterButton m={m} id={c.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
