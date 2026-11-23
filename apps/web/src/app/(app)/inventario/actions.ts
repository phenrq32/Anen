"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrors, parseAmountInput, stockItemSchema, stockMovementSchema } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

function refresh() {
  revalidatePath("/inventario", "layout");
  revalidatePath("/compras", "layout");
}

async function writableScope() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  return { m, session, scope };
}

export async function saveStockItemAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await writableScope();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = stockItemSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    sku: formString(formData, "sku"),
    unit: formString(formData, "unit"),
    currencyCode: formString(formData, "currencyCode") || scope.defaultCurrency,
    minQuantity: formString(formData, "minQuantity"),
    targetQuantity: formString(formData, "targetQuantity"),
    preferredSupplierId: formString(formData, "preferredSupplierId"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  if (!v.id && !v.unit) return { status: "error", fieldErrors: { unit: m.errors.unit_required } };
  const fields = {
    name: v.name,
    sku: v.sku,
    min_quantity: v.minQuantity,
    target_quantity: v.targetQuantity,
    preferred_supplier_id: v.preferredSupplierId,
    notes: v.notes,
  };
  const result = v.id
    ? await session.supabase.from("stock_items").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase
        .from("stock_items")
        .insert({ ...businessScopeFields(scope), ...fields, unit: v.unit ?? "", currency_code: v.currencyCode })
        .select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  const id = result.data?.[0]?.id;
  if (!id) return { status: "error", message: m.errors.forbidden };
  refresh();
  if (!v.id) redirect(`/inventario/${id}`);
  return { status: "success", message: m.inventory.saved };
}

export async function toggleArchiveStockItemAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await writableScope();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const archive = formString(formData, "archive") === "1";
  const { data, error } = await session.supabase
    .from("stock_items")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  return { status: "success" };
}

export async function deleteStockItemAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await writableScope();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("stock_items")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  redirect("/inventario");
}

export async function recordStockMovementAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await writableScope();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = stockMovementSchema.safeParse({
    itemId: formString(formData, "itemId"),
    kind: formString(formData, "kind"),
    quantity: formString(formData, "quantity"),
    unitCost: formString(formData, "unitCost"),
    occurredOn: formString(formData, "occurredOn"),
    notes: formString(formData, "notes"),
    lotCode: formString(formData, "lotCode"),
    expiresOn: formString(formData, "expiresOn"),
    lotId: formString(formData, "lotId"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: item } = await session.supabase
    .from("stock_items")
    .select("currency_code")
    .eq("id", v.itemId)
    .eq(scope.column, scope.value)
    .maybeSingle();
  if (!item) return { status: "error", message: m.errors.stock_item_invalid };
  let unitCost: number | null = null;
  if (v.kind === "in") {
    const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", item.currency_code).maybeSingle();
    const cost = currency ? parseAmountInput(v.unitCost, currency.minor_unit) : null;
    if (cost === null) return { status: "error", fieldErrors: { unitCost: m.errors.amount_invalid } };
    unitCost = Number(cost);
  }
  const { error } = await session.supabase.from("stock_movements").insert({
    ...businessScopeFields(scope),
    item_id: v.itemId,
    kind: v.kind,
    quantity: v.quantity,
    unit_cost_minor: unitCost,
    occurred_on: v.occurredOn,
    notes: v.notes,
    lot_code: v.lotCode,
    expires_on: v.expiresOn,
    lot_id: v.lotId,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success", message: m.inventory.movement.saved };
}

export async function createReorderDraftsAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await writableScope();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase.rpc("create_reorder_drafts", { p_org: scope.orgId });
  if (error || !data) return { status: "error", message: errorMessage(m, error) };
  refresh();
  // O botão desaparece com a lista; o resumo segue para os rascunhos em Compras.
  redirect(`/compras?estado=draft&reposicao=${data.orders}-${data.lines}-${data.skipped}`);
}
