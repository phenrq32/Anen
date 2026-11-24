import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { format, lookup } from "@anen/i18n";
import { PageHeader, Section, buttonClass } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { createQuoteAction } from "../actions";
import { WorkspaceField } from "@/components/workspace-context";
import { ModelPicker } from "./model-picker";
import { numericText } from "@anen/validation";

export const metadata: Metadata = { title: "Novo orçamento" };

const PDF_BY_COUNTRY: Record<string, string> = {
  PT: "/modelos/Modelos_Orcamento_2026_Portugal.pdf",
  BR: "/modelos/Modelos_Orcamento_2026_Brasil.pdf",
};

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  if (!scope.canWrite) redirect("/orcamentos");
  const params = await searchParams;
  const t = m.quotes.models;

  // Modelos com preço da moeda do workspace (Portugal em EUR, Brasil em BRL); nunca de outra moeda.
  const [templatesRes, setRes, currencyRes] = await Promise.all([
    session.supabase.from("quote_templates").select("*").order("name"),
    session.supabase.from("quote_model_sets").select("*").eq("currency_code", scope.defaultCurrency).order("version", { ascending: false }).limit(1).maybeSingle(),
    session.supabase.from("currencies").select("minor_unit").eq("code", scope.defaultCurrency).maybeSingle(),
  ]);
  const sorted = [...(templatesRes.data ?? [])].sort((a, b) => (a.key === "blank" ? 1 : b.key === "blank" ? -1 : 0));
  const set = setRes.data;
  const modelsRes = set
    ? await session.supabase
        .from("quote_service_models")
        .select("service_key, template_key, name, unit, recommended_minor, range_min_minor, range_max_minor, materials, note, composition")
        .eq("set_id", set.id)
        .order("position")
    : { data: [] };
  const models = modelsRes.data ?? [];
  const counts = new Map<string, number>();
  for (const x of models) counts.set(x.template_key, (counts.get(x.template_key) ?? 0) + 1);

  const category = params.categoria && sorted.some((x) => x.key === params.categoria) ? params.categoria : null;
  const categoryName = (key: string) => lookup(m.quotes.templates, key) ?? sorted.find((x) => x.key === key)?.name ?? key;

  if (category && set) {
    const list = models.filter((x) => x.template_key === category);
    return (
      <>
        <PageHeader
          title={format(t.title, { category: categoryName(category) })}
          description={format(t.hint, { country: set.country_code === "PT" ? "Portugal" : "Brasil", version: set.version })}
        />
        <Link href="/orcamentos/novo" className="text-sm text-muted hover:text-paper">
          ← {t.back}
        </Link>
        <p className="text-sm text-muted">{set.tax_note}</p>
        {list.length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <Section title={categoryName(category)}>
            <ModelPicker
              m={m}
              locale={locale}
              setId={set.id}
              currency={set.currency_code}
              minorUnit={currencyRes.data?.minor_unit ?? 2}
              suggestedTax={set.suggested_tax_percent !== null && set.suggested_tax_label ? { percent: numericText(set.suggested_tax_percent), label: set.suggested_tax_label } : null}
              models={list.map((x) => ({
                key: x.service_key,
                name: x.name,
                unit: x.unit,
                recommendedMinor: String(x.recommended_minor),
                rangeMinMinor: String(x.range_min_minor),
                rangeMaxMinor: String(x.range_max_minor),
                materials: x.materials,
                note: x.note,
                composition: x.composition.map((c) => ({ line: c.line, kind: c.kind, amountMinor: String(c.amount_minor) })),
              }))}
            />
          </Section>
        )}
        <form action={createQuoteAction}>
<WorkspaceField />
          <button type="submit" name="template" value={category} className={buttonClass("secondary")}>
            {t.noPrices}
          </button>
        </form>
        <details className="rounded-xl border border-line px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{format(t.sourcesTitle, { version: set.version })}</summary>
          <div className="mt-3 flex flex-col gap-2 text-muted">
            <p>{set.methodology}</p>
            <ul className="list-disc pl-5">
              {set.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="text-xs text-subtle">{set.disclaimer}</p>
            {PDF_BY_COUNTRY[set.country_code] ? (
              <a href={PDF_BY_COUNTRY[set.country_code]} className="text-brand underline-offset-4 hover:underline" download>
                {t.pdf}
              </a>
            ) : null}
          </div>
        </details>
      </>
    );
  }

  return (
    <>
      <PageHeader title={m.quotes.chooseTemplate} description={m.quotes.templateHint} />
      <form action={createQuoteAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
<WorkspaceField />
        {sorted.map((tpl) => (
          <div key={tpl.key} className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all hover:-translate-y-0.5 hover:border-brand/60">
            <button type="submit" name="template" value={tpl.key} className="group flex flex-1 flex-col items-start gap-2 p-5 text-left hover:bg-graphite/40">
              <span className="font-semibold group-hover:text-brand">{categoryName(tpl.key)}</span>
              <span className="line-clamp-2 text-xs text-subtle">{tpl.lines.map((l) => l.description).join(" · ") || "—"}</span>
            </button>
            {counts.get(tpl.key) ? (
              <Link href={`/orcamentos/novo?categoria=${tpl.key}`} className="border-t border-line px-5 py-2.5 text-xs font-medium text-brand hover:bg-graphite/40">
                {format(t.withPrices, { count: counts.get(tpl.key) ?? 0 })} →
              </Link>
            ) : null}
          </div>
        ))}
      </form>
    </>
  );
}
