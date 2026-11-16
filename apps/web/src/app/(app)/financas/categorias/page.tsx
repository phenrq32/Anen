import type { Metadata } from "next";
import { Badge, Section } from "@/components/ui";
import { categoryLabel, financeScope, loadFinanceBasics } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ArchiveCategoryButton, CategoryForm } from "../finance-forms";

export const metadata: Metadata = { title: "Categorias" };

export default async function CategoriesPage() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const basics = await loadFinanceBasics(session.supabase, scope);

  return (
    <div className="flex flex-col gap-6">
      {scope.canWrite ? (
        <Section title={m.finance.category.new}>
          <CategoryForm m={m} />
        </Section>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {(["income", "expense"] as const).map((kind) => (
          <Section key={kind} title={kind === "income" ? m.finance.chart.income : m.finance.chart.expense}>
            <ul className="-my-2 flex flex-col">
              {basics.categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                    <span className="flex-1 text-sm">{categoryLabel(m, c)}</span>
                    <Badge>{c.is_system ? m.finance.category.system : m.finance.category.custom}</Badge>
                    {!c.is_system && scope.canWrite ? <ArchiveCategoryButton m={m} id={c.id} /> : null}
                  </li>
                ))}
            </ul>
          </Section>
        ))}
      </div>
    </div>
  );
}
