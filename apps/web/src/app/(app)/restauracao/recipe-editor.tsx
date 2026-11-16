"use client";

import { useMemo, useState } from "react";
import { computeRecipe, decimalToString } from "@anen/financial-engine";
import { formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { parseAmountInput, parsePercentInput, parseQuantityInput } from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, cx } from "@/components/ui";
import { saveRecipeAction } from "../orcamentos/actions";

export interface IngredientRow {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  packageQuantity: string;
  packagePrice: string;
  waste: string;
}

export interface RecipeFields {
  id: string;
  name: string;
  category: string;
  portions: string;
  targetFoodCost: string;
  minMargin: string;
  taxRate: string;
  energy: string;
  water: string;
  labor: string;
  packaging: string;
  overhead: string;
  currency: string;
}

let seq = 0;
const key = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;
const EXTRAS = ["energy", "water", "labor", "packaging", "overhead"] as const;

export function RecipeEditor({
  m,
  locale,
  recipe,
  initialIngredients,
  minorUnit,
  readOnly,
}: {
  m: Messages;
  locale: Locale;
  recipe: RecipeFields;
  initialIngredients: IngredientRow[];
  minorUnit: number;
  readOnly: boolean;
}) {
  const [rows, setRows] = useState(initialIngredients);
  const [f, setF] = useState(recipe);
  const fmt = (v: bigint) => formatMoney(v, recipe.currency, minorUnit, locale);

  const result = useMemo(() => {
    try {
      const ingredients = rows.map((r) => {
        const quantity = parseQuantityInput(r.quantity);
        const pack = parseQuantityInput(r.packageQuantity);
        const price = parseAmountInput(r.packagePrice || "0", minorUnit);
        const waste = parsePercentInput(r.waste || "0", { exclusiveMax: true });
        if (quantity === null || !pack || price === null || waste === null) throw new Error("row");
        return { quantity, packageQuantity: pack, packagePriceMinor: price, wastePercent: waste };
      });
      const extras = EXTRAS.map((k) => {
        const v = parseAmountInput(f[k] || "0", minorUnit);
        if (v === null) throw new Error("extra");
        return v;
      });
      const portions = parseQuantityInput(f.portions);
      const target = parsePercentInput(f.targetFoodCost);
      const minMargin = parsePercentInput(f.minMargin || "0", { exclusiveMax: true });
      const tax = parsePercentInput(f.taxRate || "0");
      if (!portions || !target || minMargin === null || tax === null) throw new Error("fields");
      return computeRecipe({
        currency: recipe.currency,
        portions,
        ingredients,
        extraCostsMinor: extras,
        targetFoodCostPercent: target,
        minimumMarginPercent: minMargin,
        taxRatePercent: tax,
      });
    } catch {
      return null;
    }
  }, [rows, f, minorUnit, recipe.currency]);

  const set = (k: keyof RecipeFields) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const update = (k: string, patch: Partial<IngredientRow>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const cell = "h-10 w-full min-w-0 rounded-md border border-line bg-ink px-2.5 text-sm text-paper focus:border-brand focus:outline-none";

  return (
    <ActionForm action={saveRecipeAction}>
      {(state) => (
        <fieldset disabled={readOnly} className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <input type="hidden" name="id" value={recipe.id} />
          <input type="hidden" name="ingredients" value={JSON.stringify(rows.map(({ key: _k, ...r }) => r))} />
          <div className="flex min-w-0 flex-col gap-6">
            <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2 sm:p-6">
              <Field name="name" label={m.recipes.name} value={f.name} onChange={set("name")} required maxLength={120} error={state.fieldErrors?.name} />
              <Field name="category" label={m.recipes.category} optionalLabel={m.common.optional} value={f.category} onChange={set("category")} maxLength={60} />
              <Field name="portions" label={m.recipes.portions} inputMode="decimal" value={f.portions} onChange={set("portions")} error={state.fieldErrors?.portions} className="tabular" />
              <Field name="targetFoodCost" label={m.recipes.targetFoodCost} inputMode="decimal" value={f.targetFoodCost} onChange={set("targetFoodCost")} error={state.fieldErrors?.targetFoodCost} className="tabular" />
              <Field name="minMargin" label={m.recipes.minMargin} inputMode="decimal" value={f.minMargin} onChange={set("minMargin")} error={state.fieldErrors?.minMargin} className="tabular" />
              <Field name="taxRate" label={m.recipes.taxRate} inputMode="decimal" value={f.taxRate} onChange={set("taxRate")} error={state.fieldErrors?.taxRate} className="tabular" />
            </section>

            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="text-base font-semibold">{m.recipes.ingredients}</h2>
              <div className="hidden grid-cols-[1fr_80px_60px_90px_100px_80px_90px_36px] gap-2 text-xs text-subtle lg:grid">
                <span>{m.recipes.ingredient.name}</span>
                <span>{m.recipes.ingredient.quantity}</span>
                <span>{m.recipes.ingredient.unit}</span>
                <span>{m.recipes.ingredient.packageQuantity}</span>
                <span>{m.recipes.ingredient.packagePrice}</span>
                <span>{m.recipes.ingredient.waste}</span>
                <span className="text-right">{m.recipes.ingredient.cost}</span>
                <span />
              </div>
              <ul className="flex flex-col gap-3 lg:gap-2">
                {rows.map((r, i) => (
                  <li key={r.key} className="grid grid-cols-3 gap-2 rounded-lg border border-line p-3 lg:grid-cols-[1fr_80px_60px_90px_100px_80px_90px_36px] lg:items-center lg:border-0 lg:p-0">
                    <input aria-label={m.recipes.ingredient.name} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className={cx(cell, "col-span-3 lg:col-span-1")} />
                    <input aria-label={m.recipes.ingredient.quantity} inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className={cx(cell, "tabular text-right")} />
                    <input aria-label={m.recipes.ingredient.unit} value={r.unit} maxLength={12} onChange={(e) => update(r.key, { unit: e.target.value })} className={cell} />
                    <input aria-label={m.recipes.ingredient.packageQuantity} inputMode="decimal" value={r.packageQuantity} onChange={(e) => update(r.key, { packageQuantity: e.target.value })} className={cx(cell, "tabular text-right")} />
                    <input aria-label={m.recipes.ingredient.packagePrice} inputMode="decimal" value={r.packagePrice} placeholder="0,00" onChange={(e) => update(r.key, { packagePrice: e.target.value })} className={cx(cell, "tabular text-right")} />
                    <input aria-label={m.recipes.ingredient.waste} inputMode="decimal" value={r.waste} onChange={(e) => update(r.key, { waste: e.target.value })} className={cx(cell, "tabular text-right")} />
                    <span className="tabular self-center text-right text-sm font-medium">{result ? fmt(result.ingredientCosts[i]!.amountMinor) : "—"}</span>
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="grid size-9 place-items-center justify-self-end rounded-md text-subtle hover:bg-graphite hover:text-danger" aria-label={`${m.quotes.line.remove} ${i + 1}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => setRows((rs) => [...rs, { key: key(), name: "", quantity: "", unit: "g", packageQuantity: "1000", packagePrice: "", waste: "0" }])}
                  className="h-9 self-start rounded-full border border-line px-3 text-sm text-muted hover:border-brand hover:text-paper"
                >
                  + {m.recipes.ingredient.add}
                </button>
              )}
            </section>

            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="text-base font-semibold">{m.recipes.extras.title}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {EXTRAS.map((k) => (
                  <Field key={k} name={k} label={m.recipes.extras[k]} inputMode="decimal" value={f[k]} onChange={set(k)} placeholder="0,00" error={state.fieldErrors?.[k]} className="tabular" />
                ))}
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5" aria-live="polite">
              {result ? (
                <>
                  <Line label={m.recipes.summary.totalCost} value={fmt(result.totalCost.amountMinor)} />
                  <Line label={m.recipes.summary.ingredientsPerPortion} value={fmt(result.ingredientCostPerPortion.amountMinor)} />
                  <Line label={m.recipes.summary.perPortion} value={fmt(result.costPerPortion.amountMinor)} strong />
                  <Line label={m.recipes.summary.minimumPrice} value={fmt(result.minimumPrice.amountMinor)} />
                  <div className="mt-2 rounded-lg bg-brand/10 p-4">
                    <p className="text-sm text-muted">{m.recipes.summary.recommended}</p>
                    <p className="tabular text-3xl font-bold text-brand">{fmt(result.recommendedPrice.amountMinor)}</p>
                    <p className="tabular mt-1 text-sm text-muted">
                      {m.recipes.summary.recommendedWithTax}: {fmt(result.recommendedPriceWithTax.amountMinor)}
                    </p>
                    <p className="tabular text-sm text-muted">
                      {m.recipes.summary.foodCost}: {result.foodCostPercent ? decimalToString(result.foodCostPercent).replace(".", ",") : "—"} %
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-danger">{m.quotes.summary.invalid}</p>
              )}
              {readOnly ? null : (
                <SubmitButton pendingLabel={m.common.saving} className="w-full">
                  {m.recipes.save}
                </SubmitButton>
              )}
            </section>
          </aside>
        </fieldset>
      )}
    </ActionForm>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cx("tabular", strong && "text-base font-semibold")}>{value}</span>
    </div>
  );
}
