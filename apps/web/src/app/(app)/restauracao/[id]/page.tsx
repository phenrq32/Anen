import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceItemKey } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { formatAmountInput } from "@anen/validation";
import { InlineAction } from "@/components/forms";
import { businessScope } from "@/lib/business";
import { todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { numericToString, quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { deleteRecipeAction } from "../../orcamentos/actions";
import { RecipeEditor, type PriceOption, type PriceUpdate, type StockOption } from "../recipe-editor";
import { ProductionForm } from "../production-form";
import { formatQuantity } from "../../inventario/quantity";

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

  // Preços registados de fornecedores na moeda da ficha: o mais recente de cada artigo por fornecedor,
  // mais os que já estão ligados. Sem business.read, não se mostram (as ligações mantêm-se).
  const biz = businessScope(session);
  let priceOptions: PriceOption[] | null = null;
  let stockOptions: StockOption[] | null = null;
  let productions: Array<{ id: string; portions: number | string; occurred_on: string; notes: string | null }> = [];
  const updates: Record<string, PriceUpdate> = {};
  if (biz.canRead) {
    const [{ data: prices }, { data: suppliers }, { data: changes }, { data: stock }, { data: prods }] = await Promise.all([
      session.supabase
        .from("supplier_prices")
        .select("*")
        .eq(biz.column, biz.value)
        .eq("currency_code", recipe.currency_code)
        .order("observed_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
      session.supabase.from("contacts").select("id, name").eq(biz.column, biz.value).in("kind", ["supplier", "both"]),
      session.supabase.rpc("recipe_price_updates", { p_recipe_id: recipe.id }),
      // Artigos ativos do mesmo âmbito da ficha (a ficha e o stock partilham o âmbito pessoal/organização).
      session.supabase.from("stock_items").select("id, name, unit, archived_at").eq(biz.column, biz.value).order("name").limit(1000),
      session.supabase.from("recipe_productions").select("id, portions, occurred_on, notes").eq("recipe_id", recipe.id).order("created_at", { ascending: false }).limit(10),
    ]);
    const linkedStock = new Set((ingredients ?? []).map((i) => i.stock_item_id).filter(Boolean));
    stockOptions = (stock ?? []).filter((x) => !x.archived_at || linkedStock.has(x.id)).map((x) => ({ id: x.id, name: x.name, unit: x.unit }));
    productions = prods ?? [];
    const names = new Map((suppliers ?? []).map((c) => [c.id, c.name]));
    const linkedIds = new Set((ingredients ?? []).map((i) => i.supplier_price_id).filter(Boolean));
    const seen = new Set<string>();
    priceOptions = [];
    for (const p of prices ?? []) {
      const seriesKey = `${p.contact_id}|${priceItemKey(p.item_name, p.unit, p.currency_code)}`;
      const latest = !seen.has(seriesKey);
      seen.add(seriesKey);
      if (!latest && !linkedIds.has(p.id)) continue;
      priceOptions.push({ id: p.id, supplier: names.get(p.contact_id) ?? "—", item: p.item_name, unit: p.unit, priceMinor: p.unit_price_minor, observedOn: p.observed_on });
    }
    priceOptions.sort((a, b) => a.item.localeCompare(b.item, "pt") || a.supplier.localeCompare(b.supplier, "pt"));
    for (const c of changes ?? []) {
      updates[c.ingredient_id] = {
        linkedPriceId: c.linked_price_id,
        usedMinor: c.used_price_minor,
        latest: { id: c.latest_price_id, supplier: c.supplier_name, item: "", unit: c.latest_unit, priceMinor: c.latest_price_minor, observedOn: c.latest_observed_on },
      };
      const option = priceOptions.find((o) => o.id === c.latest_price_id);
      if (option) updates[c.ingredient_id]!.latest = option;
    }
  }

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
        priceOptions={priceOptions}
        updates={updates}
        stockOptions={stockOptions}
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
          supplierPriceId: i.supplier_price_id ?? "",
          stockItemId: i.stock_item_id ?? "",
        }))}
      />
      {biz.canRead ? (
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="production-title">
          <div className="flex flex-col gap-1">
            <h2 id="production-title" className="text-base font-semibold">{m.recipes.production.title}</h2>
            <p className="text-sm text-muted">{m.recipes.production.description}</p>
          </div>
          {!(ingredients ?? []).some((i) => i.stock_item_id) ? (
            <p className="text-sm text-muted">{m.recipes.production.noLinks}</p>
          ) : biz.canWrite ? (
            <ProductionForm m={m} recipeId={recipe.id} portions={dec(recipe.portions)} today={todayIn(scope.timezone)} />
          ) : (
            <p className="text-sm text-muted">{m.recipes.production.noPermission}</p>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{m.recipes.production.history}</h3>
            {productions.length === 0 ? (
              <p className="text-sm text-muted">{m.recipes.production.empty}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {productions.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                    <span className="tabular">
                      {format(m.recipes.production.row, {
                        portions: formatQuantity(p.portions, locale),
                        date: formatDate(p.occurred_on, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }),
                      })}
                    </span>
                    {p.notes ? <span className="text-subtle">{p.notes}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
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
