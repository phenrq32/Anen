"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  QuoteDiscountTooLargeError,
  SERVICE_MODEL_MARGIN_PERCENT,
  computeQuote,
  computeRecipe,
  defaultNature,
  quoteLinesFromServiceModels,
  SERVICE_MODEL_MAX_SELECTION,
  type IngredientInput,
  type QuoteBreakdown,
} from "@anen/financial-engine";
import { format } from "@anen/i18n";
import type { QuoteStatus } from "@anen/types";
import {
  fieldErrors,
  parseAmountInput,
  parsePercentInput,
  numericText,
  parseQuantityInput,
  parseQuoteDiscount,
  parseQuoteLines,
  quoteHeaderSchema,
} from "@anen/validation";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { scopeFields } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

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
  await guardWorkspace(formData);
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
      discount_percent: 0,
      discount_fixed_minor: 0,
      discount_minor: 0,
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
        nature: defaultNature(l.kind),
        section: null,
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

/**
 * Novo orçamento a partir de um ou mais modelos com preço (mesma edição e categoria): linhas = composição
 * do preço recomendado de cada serviço, com a quantidade de cada um, margem 0 % (o preço já a inclui) e,
 * em Portugal, o IVA só se o profissional o pedir. Totais calculados pelo motor e gravados como no editor.
 * Com um só serviço, o orçamento guarda o modelo de origem (referência de mercado no editor).
 */
export async function createQuoteFromModelAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const keys = [...new Set(formData.getAll("service").filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (keys.length === 0) return { status: "error", message: m.errors.service_required };
  if (keys.length > SERVICE_MODEL_MAX_SELECTION) return { status: "error", message: format(m.errors.services_too_many, { max: SERVICE_MODEL_MAX_SELECTION }) };
  const quantities = new Map<string, string>();
  const fieldErrors: Record<string, string> = {};
  for (const key of keys) {
    const q = parseQuantityInput(formString(formData, `quantity_${key}`));
    if (q === null || Number(q) <= 0) fieldErrors[`quantity_${key}`] = m.errors.quantity_invalid;
    else quantities.set(key, q);
  }
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors };
  const setId = formString(formData, "set");
  const [setRes, modelsRes] = await Promise.all([
    session.supabase.from("quote_model_sets").select("*").eq("id", setId).maybeSingle(),
    session.supabase.from("quote_service_models").select("*").eq("set_id", setId).in("service_key", keys),
  ]);
  const set = setRes.data;
  const byKey = new Map((modelsRes.data ?? []).map((x) => [x.service_key, x]));
  const models = keys.map((k) => byKey.get(k));
  // Só modelos da moeda do workspace (nunca misturar moedas), todos encontrados e da mesma categoria.
  if (!set || set.currency_code !== scope.defaultCurrency || models.some((x) => !x)) return { status: "error", message: m.errors.generic };
  const chosen = models.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const first = chosen[0]!;
  if (chosen.some((x) => x.template_key !== first.template_key)) return { status: "error", message: m.errors.generic };
  const single = chosen.length === 1;
  const addTax = formData.get("addTax") === "1" && set.suggested_tax_percent !== null;
  // numeric chega do PostgREST como número (23) e o motor quer texto decimal ("23").
  const taxRate = addTax && set.suggested_tax_percent !== null ? numericText(set.suggested_tax_percent) : "0";
  const lines = quoteLinesFromServiceModels(
    chosen.map((x) => ({
      name: x.name,
      unit: x.unit,
      quantity: quantities.get(x.service_key)!,
      composition: x.composition.map((c) => ({ line: c.line, kind: c.kind, amountMinor: BigInt(c.amount_minor) })),
    })),
  );
  const breakdown = computeQuote({
    currency: set.currency_code,
    lines: lines.map((l) => ({ kind: l.kind, nature: l.nature, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
    marginPercent: SERVICE_MODEL_MARGIN_PERCENT,
    taxRatePercent: taxRate,
  });
  const taxLabel = addTax ? set.suggested_tax_label : null;
  const title = (single ? first.name : format(m.quotes.models.titleMany, { first: first.name, count: chosen.length - 1 })).slice(0, 160);
  const materialsText = (x: (typeof chosen)[number]) => (x.materials ? format(m.quotes.models.materialsLine, { materials: x.materials }) : null);
  const description = single
    ? materialsText(first)
    : chosen.map((x) => (x.materials ? `${x.name}: ${x.materials}` : null)).filter(Boolean).join("\n").slice(0, 4000) || null;
  const conditions = single
    ? (first.note ?? null)
    : chosen.map((x) => (x.note ? `${x.name}: ${x.note}` : null)).filter(Boolean).join("\n").slice(0, 4000) || null;
  const { data: created, error: createError } = await session.supabase
    .from("quotes")
    .insert({
      ...scopeFields(scope),
      number: "pendente",
      template_key: first.template_key,
      service_model_set_id: single ? first.set_id : null,
      service_model_key: single ? first.service_key : null,
      title,
      currency_code: set.currency_code,
      margin_percent: Number(SERVICE_MODEL_MARGIN_PERCENT),
      tax_rate_percent: Number(taxRate),
      description: null,
      client_contact_id: null,
      client_name: null,
      client_email: null,
      client_tax_id: null,
      client_address: null,
      valid_until: null,
      tax_label: taxLabel,
      conditions: null,
      discount_percent: 0,
      discount_fixed_minor: 0,
      discount_minor: 0,
      total_cost_minor: 0,
      price_before_tax_minor: 0,
      tax_minor: 0,
      total_minor: 0,
    })
    .select("id")
    .single();
  if (createError || !created) return { status: "error", message: errorMessage(m, createError) };
  const { error } = await session.supabase.rpc("save_quote_content", {
    p_quote_id: created.id,
    p_fields: {
      title,
      description,
      client_contact_id: null,
      client_name: null,
      client_email: null,
      client_tax_id: null,
      client_address: null,
      valid_until: null,
      margin_percent: SERVICE_MODEL_MARGIN_PERCENT,
      tax_rate_percent: taxRate,
      tax_label: taxLabel,
      conditions,
      discount_percent: "0",
      discount_fixed_minor: "0",
      discount_minor: breakdown.discount.amountMinor.toString(),
      total_cost_minor: breakdown.totalCost.amountMinor.toString(),
      price_before_tax_minor: breakdown.priceBeforeTax.amountMinor.toString(),
      tax_minor: breakdown.tax.amountMinor.toString(),
      total_minor: breakdown.total.amountMinor.toString(),
    },
    p_items: lines.map((l, i) => ({
      position: i,
      kind: l.kind,
      nature: l.nature,
      section: l.section ?? null,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_cost_minor: l.unitCostMinor.toString(),
      total_cost_minor: breakdown.lineTotals[i]!.amountMinor.toString(),
    })),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${created.id}`);
}

export async function saveQuoteAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
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
    discountType: formString(formData, "discountType") || "none",
    discountValue: formString(formData, "discountValue"),
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
  const discount = parseQuoteDiscount(v.discountType, v.discountValue, unit);
  if (discount === null) {
    return { status: "error", fieldErrors: { discountValue: v.discountType === "percent" ? m.errors.percent_invalid : m.errors.amount_invalid } };
  }
  const lines = parseQuoteLines(safeJson(formString(formData, "lines")), unit);
  if (!lines) return { status: "error", message: m.errors.generic };
  const firstError = Object.entries(lines.errors)[0];
  if (firstError) return { status: "error", message: `${Number(firstError[0]) + 1}: ${m.errors[firstError[1] as "quantity_invalid"]}` };

  // Cálculo no servidor com o motor determinístico (o cálculo no navegador é só pré-visualização).
  let breakdown: QuoteBreakdown;
  try {
    breakdown = computeQuote({
      currency: quote.currency_code,
      lines: lines.lines.map((l) => ({ kind: l.kind, nature: l.nature, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
      marginPercent: margin,
      taxRatePercent: taxRate,
      discount,
    });
  } catch (err) {
    if (err instanceof QuoteDiscountTooLargeError) return { status: "error", fieldErrors: { discountValue: m.errors.discount_too_large } };
    throw err;
  }
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
      discount_percent: discount.type === "percent" ? discount.percent : "0",
      discount_fixed_minor: discount.type === "amount" ? discount.amountMinor.toString() : "0",
      discount_minor: breakdown.discount.amountMinor.toString(),
      total_cost_minor: breakdown.totalCost.amountMinor.toString(),
      price_before_tax_minor: breakdown.priceBeforeTax.amountMinor.toString(),
      tax_minor: breakdown.tax.amountMinor.toString(),
      total_minor: breakdown.total.amountMinor.toString(),
    },
    p_items: lines.lines.map((l, i) => ({
      position: i,
      kind: l.kind,
      nature: l.nature,
      section: l.section || null,
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
  await guardWorkspace(formData);
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

/** Apaga um ou vários orçamentos (campo `id`, repetido), em qualquer estado. A base de dados confirma a permissão. */
export async function deleteQuoteAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const ids = [...new Set(formData.getAll("id").map(String))].filter((v) => UUID.test(v)).slice(0, 200);
  if (ids.length === 0) return { status: "error", message: m.errors.generic };
  const { data, error } = await session.supabase.from("quotes").delete().in("id", ids).eq(scope.column, scope.value).select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/orcamentos");
  redirect(`/orcamentos?apagados=${data.length}`);
}

// ---------------------------------------------------------------------------
// Fichas técnicas
// ---------------------------------------------------------------------------
export async function createRecipeAction(formData: FormData): Promise<void> {
  await guardWorkspace(formData);
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
  supplierPriceId?: string;
  stockItemId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveRecipeAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
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
  const ingredients: Array<IngredientInput & { name: string; unit: string; supplierPriceId: string | null; stockItemId: string | null }> = [];
  for (const [i, item] of (raw as RawIngredient[]).entries()) {
    const quantity = parseQuantityInput(String(item.quantity ?? ""));
    const pack = parseQuantityInput(String(item.packageQuantity ?? ""));
    const price = parseAmountInput(String(item.packagePrice ?? ""), unit);
    const waste = parsePercentInput(String(item.waste ?? "0"), { exclusiveMax: true });
    const label = String(item.name ?? "").trim().slice(0, 120);
    const supplierPriceId = String(item.supplierPriceId ?? "");
    const stockItemId = String(item.stockItemId ?? "");
    if (!label || quantity === null || !pack || Number(pack) <= 0 || price === null || waste === null) {
      return { status: "error", message: `${m.recipes.ingredients} ${i + 1}: ${m.errors.quantity_invalid}` };
    }
    if (supplierPriceId && !UUID.test(supplierPriceId)) {
      return { status: "error", message: `${m.recipes.ingredients} ${i + 1}: ${m.errors.supplier_price_invalid}` };
    }
    if (stockItemId && !UUID.test(stockItemId)) {
      return { status: "error", message: `${m.recipes.ingredients} ${i + 1}: ${m.errors.stock_item_invalid}` };
    }
    ingredients.push({
      name: label,
      unit: String(item.unit ?? "g").slice(0, 12) || "g",
      quantity,
      packageQuantity: pack,
      packagePriceMinor: price,
      wastePercent: waste,
      supplierPriceId: supplierPriceId || null,
      stockItemId: stockItemId || null,
    });
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
      supplier_price_id: ing.supplierPriceId,
      stock_item_id: ing.stockItemId,
    })),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/restauracao");
  revalidatePath(`/restauracao/${recipe.id}`);
  return { status: "success", message: m.recipes.saved };
}

export async function deleteRecipeAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("recipes").delete().eq("id", formString(formData, "id"));
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/restauracao");
  redirect("/restauracao");
}

/** Regista uma produção da ficha: dá saída dos ingredientes ligados ao stock (tudo ou nada, no servidor). */
export async function produceRecipeAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session } = await context();
  const id = formString(formData, "id");
  if (!UUID.test(id)) return { status: "error", message: m.errors.forbidden };
  const portions = parseQuantityInput(formString(formData, "portions"));
  if (!portions || Number(portions) <= 0) return { status: "error", fieldErrors: { portions: m.errors.quantity_invalid } };
  const occurredOn = formString(formData, "occurredOn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || Number.isNaN(Date.parse(`${occurredOn}T00:00:00Z`))) {
    return { status: "error", fieldErrors: { occurredOn: m.errors.date_invalid } };
  }
  const notes = formString(formData, "notes").trim().slice(0, 500) || null;
  const { data: production, error } = await session.supabase.rpc("produce_recipe", {
    p_recipe_id: id,
    p_portions: portions,
    p_occurred_on: occurredOn,
    p_notes: notes,
  });
  if (error || !production) return { status: "error", message: errorMessage(m, error) };
  const { count } = await session.supabase.from("stock_movements").select("id", { count: "exact", head: true }).eq("production_id", production);
  revalidatePath(`/restauracao/${id}`);
  revalidatePath("/inventario");
  return { status: "success", message: format(m.recipes.production.saved, { count: count ?? 0 }) };
}
