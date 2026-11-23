"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { format } from "@anen/i18n";
import { fieldErrors, parseAmountInput, purchaseLineSchema, purchaseOrderSchema, receivePurchaseSchema } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

function refresh(orderId?: string) {
  revalidatePath("/compras", "layout");
  revalidatePath("/inventario", "layout");
  if (orderId) revalidatePath(`/compras/${orderId}`);
}

async function context() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  return { m, session, scope: businessScope(session) };
}

export async function createPurchaseOrderAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = purchaseOrderSchema.safeParse({
    supplierId: formString(formData, "supplierId"),
    currencyCode: formString(formData, "currencyCode"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { data, error } = await session.supabase
    .from("purchase_orders")
    .insert({ ...businessScopeFields(scope), supplier_id: parsed.data.supplierId, currency_code: parsed.data.currencyCode })
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  const id = data?.[0]?.id;
  if (!id) return { status: "error", message: m.errors.forbidden };
  refresh();
  redirect(`/compras/${id}`);
}

export async function savePurchaseOrderAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = purchaseOrderSchema.safeParse({
    id: formString(formData, "id"),
    supplierId: formString(formData, "supplierId"),
    currencyCode: formString(formData, "currencyCode"),
    projectId: formString(formData, "projectId"),
    orderedOn: formString(formData, "orderedOn"),
    expectedOn: formString(formData, "expectedOn"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  if (!v.id) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("purchase_orders")
    .update({
      supplier_id: v.supplierId,
      currency_code: v.currencyCode,
      project_id: v.projectId,
      ordered_on: v.orderedOn,
      expected_on: v.expectedOn,
      notes: v.notes,
    })
    .eq("id", v.id)
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh(v.id);
  return { status: "success", message: m.purchases.saved };
}

export async function addPurchaseLineAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = purchaseLineSchema.safeParse({
    orderId: formString(formData, "orderId"),
    stockItemId: formString(formData, "stockItemId"),
    description: formString(formData, "description"),
    quantity: formString(formData, "quantity"),
    unit: formString(formData, "unit"),
    unitPrice: formString(formData, "unitPrice"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: order } = await session.supabase
    .from("purchase_orders")
    .select("currency_code")
    .eq("id", v.orderId)
    .eq(scope.column, scope.value)
    .maybeSingle();
  if (!order) return { status: "error", message: m.errors.forbidden };
  let description = v.description;
  if (!description && v.stockItemId) {
    const { data: item } = await session.supabase.from("stock_items").select("name").eq("id", v.stockItemId).eq(scope.column, scope.value).maybeSingle();
    description = item?.name ?? null;
  }
  if (!description) return { status: "error", fieldErrors: { description: m.errors.description_required } };
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", order.currency_code).maybeSingle();
  const price = currency ? parseAmountInput(v.unitPrice, currency.minor_unit) : null;
  if (price === null) return { status: "error", fieldErrors: { unitPrice: m.errors.amount_invalid } };
  const { count } = await session.supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("order_id", v.orderId);
  const { error } = await session.supabase.from("purchase_order_items").insert({
    order_id: v.orderId,
    position: Math.min(count ?? 0, 500),
    stock_item_id: v.stockItemId,
    description,
    quantity: v.quantity,
    unit: v.unit,
    unit_price_minor: Number(price),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh(v.orderId);
  return { status: "success", message: m.purchases.lines.added };
}

export async function removePurchaseLineAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase.from("purchase_order_items").delete().eq("id", formString(formData, "id")).select("order_id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  const orderId = data?.[0]?.order_id;
  if (!orderId) return { status: "error", message: m.errors.forbidden };
  refresh(orderId);
  return { status: "success" };
}

const NEXT_STATUSES = ["ordered", "draft", "cancelled"] as const;

export async function setPurchaseStatusAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const status = formString(formData, "status");
  const next = NEXT_STATUSES.find((s) => s === status);
  if (!next) return { status: "error", message: m.errors.purchase_status_invalid };
  const id = formString(formData, "id");
  const { data, error } = await session.supabase.from("purchase_orders").update({ status: next }).eq("id", id).eq(scope.column, scope.value).select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh(id);
  return { status: "success" };
}

export async function deletePurchaseOrderAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("purchase_orders")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  redirect("/compras");
}

export async function receivePurchaseOrderAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = receivePurchaseSchema.safeParse({
    orderId: formString(formData, "orderId"),
    receivedOn: formString(formData, "receivedOn"),
    accountId: formString(formData, "accountId"),
    paid: formString(formData, "paid"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: order } = await session.supabase
    .from("purchase_orders")
    .select("supplier_id")
    .eq("id", v.orderId)
    .eq(scope.column, scope.value)
    .maybeSingle();
  if (!order) return { status: "error", message: m.errors.forbidden };
  const { data: supplier } = order.supplier_id
    ? await session.supabase.from("contacts").select("name").eq("id", order.supplier_id).maybeSingle()
    : { data: null };
  const { error } = await session.supabase.rpc("receive_purchase_order", {
    p_order_id: v.orderId,
    p_received_on: v.receivedOn,
    p_account_id: v.accountId,
    p_paid: v.paid,
    p_description: supplier ? format(m.purchases.receive.expenseDescription, { supplier: supplier.name }) : null,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh(v.orderId);
  revalidatePath("/financas", "layout");
  revalidatePath("/contactos", "layout");
  return { status: "success", message: m.purchases.receive.received };
}
