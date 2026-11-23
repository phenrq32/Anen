import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { lookup } from "@anen/i18n";
import { PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { createQuoteAction } from "../actions";
import { WorkspaceField } from "@/components/workspace-context";

export const metadata: Metadata = { title: "Novo orçamento" };

export default async function NewQuotePage() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  if (!quotesScope(session).canWrite) redirect("/orcamentos");
  const { data: templates } = await session.supabase.from("quote_templates").select("*").order("name");
  const sorted = [...(templates ?? [])].sort((a, b) => (a.key === "blank" ? 1 : b.key === "blank" ? -1 : 0));

  return (
    <>
      <PageHeader title={m.quotes.chooseTemplate} description={m.quotes.templateHint} />
      <form action={createQuoteAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
<WorkspaceField />
        {sorted.map((t) => (
          <button
            key={t.key}
            type="submit"
            name="template"
            value={t.key}
            className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:border-brand/60 hover:bg-graphite/40"
          >
            <span className="font-semibold group-hover:text-brand">{lookup(m.quotes.templates, t.key) ?? t.name}</span>
            <span className="line-clamp-2 text-xs text-subtle">
              {t.lines.map((l) => l.description).join(" · ") || "—"}
            </span>
          </button>
        ))}
      </form>
    </>
  );
}
