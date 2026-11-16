import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@anen/i18n";
import { Alert, PageHeader, buttonClass } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { createRecipeAction } from "../orcamentos/actions";

export const metadata: Metadata = { title: "Fichas técnicas" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  if (!scope.canRead) return <Alert tone="info">{m.errors.forbidden}</Alert>;
  const params = await searchParams;
  const order = params.ordem === "custo" ? "cost_per_portion_minor" : params.ordem === "preco" ? "recommended_price_minor" : "name";
  const [{ data: recipes }, { data: currencies }] = await Promise.all([
    session.supabase.from("recipes").select("*").eq(scope.column, scope.value).order(order, { ascending: order === "name" }),
    session.supabase.from("currencies").select("code, minor_unit"),
  ]);
  const units = new Map((currencies ?? []).map((c) => [c.code, c.minor_unit]));

  return (
    <>
      <PageHeader title={m.recipes.title} description={m.recipes.subtitle} />
      {scope.canWrite ? (
        <form action={createRecipeAction} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
            {m.recipes.name}
            <input name="name" required maxLength={120} className="h-11 rounded-md border border-line bg-surface px-3.5 text-[15px] focus:border-brand focus:outline-none" />
          </label>
          <button type="submit" className={buttonClass("primary")}>{m.recipes.new}</button>
        </form>
      ) : null}
      {(recipes ?? []).length === 0 ? (
        <p className="text-muted">{m.recipes.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <caption className="px-5 pt-4 text-left text-xs text-subtle">{m.recipes.compareHint}</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-5 py-3 font-medium"><Link href="/restauracao" className="hover:text-paper">{m.recipes.name}</Link></th>
                <th className="px-5 py-3 font-medium">{m.recipes.category}</th>
                <th className="px-5 py-3 text-right font-medium"><Link href="/restauracao?ordem=custo" className="hover:text-paper">{m.recipes.summary.perPortion}</Link></th>
                <th className="px-5 py-3 text-right font-medium"><Link href="/restauracao?ordem=preco" className="hover:text-paper">{m.recipes.summary.recommended}</Link></th>
              </tr>
            </thead>
            <tbody>
              {(recipes ?? []).map((r) => {
                const unit = units.get(r.currency_code) ?? 2;
                return (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-graphite/40">
                    <td className="px-5 py-3"><Link href={`/restauracao/${r.id}`} className="font-medium hover:text-brand">{r.name}</Link></td>
                    <td className="px-5 py-3 text-muted">{r.category ?? "—"}</td>
                    <td className="tabular px-5 py-3 text-right">{formatMoney(BigInt(r.cost_per_portion_minor), r.currency_code, unit, locale)}</td>
                    <td className="tabular px-5 py-3 text-right font-semibold text-brand">{formatMoney(BigInt(r.recommended_price_minor), r.currency_code, unit, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
