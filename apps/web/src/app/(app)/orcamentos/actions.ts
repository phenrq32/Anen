"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computeQuote, computeRecipe, type IngredientInput } from "@anen/financial-engine";
import { format } from "@anen/i18n";
import type { QuoteStatus } from "@anen/types";
import {
  fieldErrors,
  parseAmountInput,
  parsePercentInput,
  parseQuantityInput,
  parseQuoteLines,
  quoteHeaderSchema,
} from "@anen/validation";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { scopeFields } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";

async function context() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  return { m, session, scope };
}

async function minorUnit(session: Awaited<ReturnType<typeof context>>["session"], currency: string): Promise<number> {
  const { data } = await session.supabase.from("currencies").select("minor_unit").eq("code", currency).maybeSingle();
  return data?.minor_unit ?? 2;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------------
export async function createQuoteAction(formData: FormData): Promise<void> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) redirect("/orcamentos");
  const key = formString(formData, "template");
  const { data: template } = await session.supabase.from("quote_templates").select("*").eq("key", key).maybeSingle();
  if (!template) redirect("/orcamentos/novo");
  const name = (m.quotes.templates as Record<string, string>)[template.key] ?? template.name;
  const { data, error } = await session.supabase
    .from("quotes")
    .insert({
      ...scopeFields(scope),
      number: "pendente",
      template_key: template.key,
      title: name,
      currency_code: scope.defaultCurrency,
      margin_percent: template.default_margin_percent,
      tax_rate_percent: 0,
      description: null,
      client_contact_id: null,
      client_name: null,
      client_email: null,
      client_tax_id: null,
      client_address: null,
      valid_until: null,
      tax_label: null,
      conditions: null,
      total_cost_minor: 0,
      price_before_tax_minor: 0,
      tax_minor: 0,
      total_minor: 0,
    })
    .select("id")
    .single();
  if (error || !data) redirect("/orcamentos");
  if (template.lines.length) {
    await session.supabase.from("quote_items").insert(
      template.lines.map((l, position) => ({
        quote_id: data.id,
        position,
        kind: l.kind,
        description: l.description,
        quantity: 1,
        unit: l.unit ?? null,
        unit_cost_minor: 0,
        total_cost_minor: 0,
      })),
    );
  }
  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${data.id}`);
}

export async function saveQuoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = quoteHeaderSchema.safeParse({
    id: formString(formData, "id"),
    title: formString(formData, "title"),
    description: formString(formData, "description"),
    clientContactId: formString(formData, "clientContactId"),
    clientName: formString(formData, "clientName"),
    clientEmail: formString(formData, "clientEmail").trim().toLowerCase(),
    clientTaxId: formString(formData, "clientTaxId"),
    clientAddress: formString(formData, "clientAddress"),
    validUntil: formString(formData, "validUntil"),
    margin: formString(formData, "margin"),
    taxRate: formString(formData, "taxRate"),
    taxLabel: formString(formData, "taxLabel"),
    conditions: formString(formData, "conditions"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;

  const { data: quote } = await session.supabase.from("quotes").select("id, currency_code").eq("id", v.id).maybeSingle();
  if (!quote) return { status: "error", message: m.errors.forbidden };
  const unit = await minorUnit(session, quote.currency_code);

  const margin = parsePercentInput(v.margin, { exclusiveMax: true });
  const taxRate = parsePercentInput(v.taxRate);
  if (margin === null) return { status: "error", fieldErrors: { margin: m.errors.percent_invalid } };
  if (taxRate === null) return { status: "error", fieldErrors: { taxRate: m.errors.percent_invalid } };
  const lines = parseQuoteLines(safeJson(formString(formData, "lines")), unit);
  if (!lines) return { status: "error", message: m.errors.generic };
  const firstError = Object.entries(lines.errors)[0];
  if (firstError) return { status: "error", message: `${Number(firstError[0]) + 1}: ${m.errors[firstError[1] as "quantity_invalid"]}` };

  // Cálculo no servidor com o motor determinístico (o cálculo no navegador é só pré-visualização).
  const breakdown = computeQuote({
    currency: quote.currency_code,
    lines: lines.lines.map((l) => ({ kind: l.kind, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
    marginPercent: margin,
    taxRatePercent: taxRate,
  });
  const nullable = (s: string) => (s ? s : null);
  const { data: version, error } = await session.supabase.rpc("save_quote_content", {
    p_quote_id: quote.id,
    p_fields: {
      title: v.title,
      description: nullable(v.description),
      client_contact_id: nullable(v.clientContactId),
      client_name: nullable(v.clientName),
      client_email: nullable(v.clientEmail),
      client_tax_id: nullable(v.clientTaxId),
      client_address: nullable(v.clientAddress),
      valid_until: nullable(v.validUntil),
      margin_percent: margin,
      tax_rate_percent: taxRate,
      tax_label: nullable(v.taxLabel),
      conditions: nullable(v.conditions),
      total_cost_minor: breakdown.totalCost.amountMinor.toString(),
      price_before_tax_minor: breakdown.priceBeforeTax.amountMinor.toString(),
      tax_minor: breakdown.tax.amountMinor.toString(),
      total_minor: breakdown.total.amountMinor.toString(),
    },
    p_items: lines.lines.map((l, i) => ({
      position: i,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit || null,
      unit_cost_minor: l.unitCostMinor.toString(),
      total_cost_minor: breakdown.lineTotals[i]!.amountMinor.toString(),
    })),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${quote.id}`);
  return { status: "success", message: format(m.quotes.saved, { version: version ?? 0 }) };
}

const STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "cancelled"];

export async function setQuoteStatusAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const status = formString(formData, "status") as QuoteStatus;
  if (!STATUSES.includes(status)) return { status: "error", message: m.errors.generic };
  const id = formString(formData, "id");
  const { data, error } = await session.supabase.from("quotes").update({ status }).eq("id", id).select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { status: "success" };
}

export async function deleteQuoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("quotes").delete().eq("id", formString(formData, "id")).eq("status", "draft");
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/orcamentos");
  redirect("/orcamentos");
}

// ---------------------------------------------------------------------------
// Fichas técnicas
// ---------------------------------------------------------------------------
export async function createRecipeAction(formData: FormData): Promise<void> {
  const { session, scope } = await context();
  if (!scope.canWrite) redirect("/restauracao");
  const name = formString(formData, "name").trim().slice(0, 120) || "Prato";
  const { data } = await session.supabase
    .from("recipes")
    .insert({
      ...scopeFields(scope),
      name,
      category: null,
      currency_code: scope.defaultCurrency,
      portions: 1,
      target_food_cost_percent: 30,
      minimum_margin_percent: 0,
      tax_rate_percent: 0,
      energy_minor: 0,
      water_minor: 0,
      labor_minor: 0,
      packaging_minor: 0,
      overhead_minor: 0,
      cost_per_portion_minor: 0,
      recommended_price_minor: 0,
    })
    .select("id")
    .single();
  revalidatePath("/restauracao");
  redirect(data ? `/restauracao/${data.id}` : "/restauracao");
}

interface RawIngredient {
  name: string;
  quantity: string;
  unit: string;
  packageQuantity: string;
  packagePrice: string;
  waste: string;
}

export async function saveRecipeAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const id = formString(formData, "id");
  const { data: recipe } = await session.supabase.from("recipes").select("id, currency_code").eq("id", id).maybeSingle();
  if (!recipe) return { status: "error", message: m.errors.forbidden };
  const unit = await minorUnit(session, recipe.currency_code);

  const name = formString(formData, "name").trim();
  if (!name || name.length > 120) return { status: "error", fieldErrors: { name: m.errors.name_required } };
  const portions = parseQuantityInput(formString(formData, "portions"));
  const target = parsePercentInput(formString(formData, "targetFoodCost"));
  const minMargin = parsePercentInput(formString(formData, "minMargin"), { exclusiveMax: true });
  const taxRate = parsePercentInput(formString(formData, "taxRate"));
  if (!portions || Number(portions) <= 0) return { status: "error", fieldErrors: { portions: m.errors.quantity_invalid } };
  if (!target || Number(target) <= 0) return { status: "error", fieldErrors: { targetFoodCost: m.errors.percent_invalid } };
  if (minMargin === null) return { status: "error", fieldErrors: { minMargin: m.errors.percent_invalid } };
  if (taxRate === null) return { status: "error", fieldErrors: { taxRate: m.errors.percent_invalid } };

  const extrasKeys = ["energy", "water", "labor", "packaging", "overhead"] as const;
  const extras: Record<(typeof extrasKeys)[number], bigint> = { energy: 0n, water: 0n, labor: 0n, packaging: 0n, overhead: 0n };
  for (const k of extrasKeys) {
    const value = parseAmountInput(formString(formData, k) || "0", unit);
    if (value === null) return { status: "error", fieldErrors: { [k]: m.errors.amount_invalid } };
    extras[k] = value;
  }

  const raw = safeJson(formString(formData, "ingredients"));
  if (!Array.isArray(raw) || raw.length > 150) return { status: "error", message: m.errors.generic };
  const ingredients: Array<IngredientInput & { name: string; unit: string }> = [];
  for (const [i, item] of (raw as RawIngredient[]).entries()) {
    const quantity = parseQuantityInput(String(item.quantity ?? ""));
    const pack = parseQuantityInput(String(item.packageQuantity ?? ""));
    const price = parseAmountInput(String(item.packagePrice ?? ""), unit);
    const waste = parsePercentInput(String(item.waste ?? "0"), { exclusiveMax: true });
    const label = String(item.name ?? "").trim().slice(0, 120);
    if (!label || quantity === null || !pack || Number(pack) <= 0 || price === null || waste === null) {
      return { status: "error", message: `${m.recipes.ingredients} ${i + 1}: ${m.errors.quantity_invalid}` };
    }
    ingredients.push({ name: label, unit: String(item.unit ?? "g").slice(0, 12) || "g", quantity, packageQuantity: pack, packagePriceMinor: price, wastePercent: waste });
  }

  const result = computeRecipe({
    currency: recipe.currency_code,
    portions,
    ingredients,
    extraCostsMinor: Object.values(extras),
    targetFoodCostPercent: target,
    minimumMarginPercent: minMargin,
    taxRatePercent: taxRate,
  });
  const { error } = await session.supabase.rpc("save_recipe_content", {
    p_recipe_id: recipe.id,
    p_fields: {
      name,
      category: formString(formData, "category").trim().slice(0, 60) || null,
      portions,
      target_food_cost_percent: target,
      minimum_margin_percent: minMargin,
      tax_rate_percent: taxRate,
      energy_minor: extras.energy.toString(),
      water_minor: extras.water.toString(),
      labor_minor: extras.labor.toString(),
      packaging_minor: extras.packaging.toString(),
      overhead_minor: extras.overhead.toString(),
      cost_per_portion_minor: result.costPerPortion.amountMinor.toString(),
      ingredient_cost_per_portion_minor: result.ingredientCostPerPortion.amountMinor.toString(),
      recommended_price_minor: result.recommendedPrice.amountMinor.toString(),
    },
    p_ingredients: ingredients.map((ing, position) => ({
      position,
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      package_quantity: ing.packageQuantity,
      package_price_minor: ing.packagePriceMinor.toString(),
      waste_percent: ing.wastePercent,
      cost_minor: result.ingredientCosts[position]!.amountMinor.toString(),
    })),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/restauracao");
  revalidatePath(`/restauracao/${recipe.id}`);
  return { status: "success", message: m.recipes.saved };
}

export async function deleteRecipeAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("recipes").delete().eq("id", formString(formData, "id"));
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/restauracao");
  redirect("/restauracao");
}
