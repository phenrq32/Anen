import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatMoney } from "@anen/i18n";
import { formatAmountInput } from "@anen/validation";
import { InlineAction } from "@/components/forms";
import { getI18n } from "@/lib/i18n";
import { numericToString, quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { deleteRecipeAction } from "../../orcamentos/actions";
import { RecipeEditor } from "../recipe-editor";

export const metadata: Metadata = { title: "Ficha técnica" };

const amount = (minor: number, unit: number) => (minor === 0 ? "" : formatAmountInput(BigInt(minor), unit));
const dec = (n: number) => numericToString(n).replace(".", ",");

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: recipe }, { data: ingredients }, { data: history }] = await Promise.all([
    session.supabase.from("recipes").select("*").eq("id", id).maybeSingle(),
    session.supabase.from("recipe_ingredients").select("*").eq("recipe_id", id).order("position"),
    session.supabase.from("recipe_cost_history").select("*").eq("recipe_id", id).order("recorded_at", { ascending: false }).limit(12),
  ]);
  if (!recipe) notFound();
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", recipe.currency_code).maybeSingle();
  const unit = currency?.minor_unit ?? 2;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/restauracao" className="text-sm text-muted hover:text-paper">← {m.recipes.title}</Link>
          <h1 className="mt-1 text-2xl font-bold sm:text-[28px]">{recipe.name}</h1>
        </div>
        {scope.canWrite ? (
          <InlineAction action={deleteRecipeAction} fields={{ id: recipe.id }} label={m.recipes.delete} pendingLabel={m.common.saving} confirmMessage={m.recipes.delete} variant="danger" />
        ) : null}
      </header>
      <RecipeEditor
        m={m}
        locale={locale}
        minorUnit={unit}
        readOnly={!scope.canWrite}
        recipe={{
          id: recipe.id,
          name: recipe.name,
          category: recipe.category ?? "",
          portions: dec(recipe.portions),
          targetFoodCost: dec(recipe.target_food_cost_percent),
          minMargin: dec(recipe.minimum_margin_percent),
          taxRate: dec(recipe.tax_rate_percent),
          energy: amount(recipe.energy_minor, unit),
          water: amount(recipe.water_minor, unit),
          labor: amount(recipe.labor_minor, unit),
          packaging: amount(recipe.packaging_minor, unit),
          overhead: amount(recipe.overhead_minor, unit),
          currency: recipe.currency_code,
        }}
        initialIngredients={(ingredients ?? []).map((i) => ({
          key: i.id,
          name: i.name,
          quantity: dec(i.quantity),
          unit: i.unit,
          packageQuantity: dec(i.package_quantity),
          packagePrice: amount(i.package_price_minor, unit),
          waste: dec(i.waste_percent),
        }))}
      />
      {(history ?? []).length > 1 ? (
        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="mb-3 text-base font-semibold">{m.recipes.history}</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(history ?? []).map((h, i, all) => {
              const prev = all[i + 1];
              const diff = prev ? h.cost_per_portion_minor - prev.cost_per_portion_minor : 0;
              return (
                <li key={h.id} className="flex justify-between gap-3">
                  <time className="tabular text-subtle">{formatDate(h.recorded_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" })}</time>
                  <span className="tabular">
                    {formatMoney(BigInt(h.cost_per_portion_minor), recipe.currency_code, unit, locale)}
                    {diff !== 0 ? (
                      <span className={diff > 0 ? "ml-2 text-danger" : "ml-2 text-success"}>
                        {diff > 0 ? "▲" : "▼"} {formatMoney(BigInt(Math.abs(diff)), recipe.currency_code, unit, locale)}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
