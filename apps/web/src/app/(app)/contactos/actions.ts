"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contactNoteSchema, contactSchema, fieldErrors, parseAmountInput, supplierPriceSchema } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

function refresh() {
  revalidatePath("/contactos", "layout");
  revalidatePath("/financas", "layout");
  revalidatePath("/projetos", "layout");
}

export async function saveContactAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = contactSchema.safeParse({
    id: formString(formData, "id"),
    kind: formString(formData, "kind"),
    name: formString(formData, "name"),
    taxId: formString(formData, "taxId"),
    email: formString(formData, "email"),
    phone: formString(formData, "phone"),
    address: formString(formData, "address"),
    paymentTermsDays: formString(formData, "paymentTermsDays"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const fields = {
    kind: v.kind,
    name: v.name,
    tax_id: v.taxId,
    email: v.email,
    phone: v.phone,
    address: v.address,
    payment_terms_days: v.paymentTermsDays,
    notes: v.notes,
  };
  const result = v.id
    ? await session.supabase.from("contacts").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("contacts").insert({ ...businessScopeFields(scope), ...fields }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  const id = result.data?.[0]?.id;
  if (!id) return { status: "error", message: m.errors.forbidden };
  refresh();
  if (!v.id) redirect(`/contactos/${id}`);
  return { status: "success", message: m.business.contacts.saved };
}

export async function toggleArchiveContactAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const archive = formString(formData, "archive") === "1";
  const { error } = await session.supabase
    .from("contacts")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// CRM: observações datadas e histórico de preços por fornecedor
// ---------------------------------------------------------------------------
function refreshContact(contactId: string) {
  revalidatePath(`/contactos/${contactId}`);
}

export async function saveContactNoteAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = contactNoteSchema.safeParse({
    id: formString(formData, "id"),
    contactId: formString(formData, "contactId"),
    kind: formString(formData, "kind"),
    notedOn: formString(formData, "notedOn"),
    body: formString(formData, "body"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const fields = { kind: v.kind, noted_on: v.notedOn, body: v.body };
  const result = v.id
    ? await session.supabase.from("contact_notes").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("contact_notes").insert({ ...businessScopeFields(scope), contact_id: v.contactId, ...fields }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refreshContact(v.contactId);
  return { status: "success", message: m.business.contacts.noteSaved };
}

export async function deleteContactNoteAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("contact_notes")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("contact_id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  const contactId = data?.[0]?.contact_id;
  if (!contactId) return { status: "error", message: m.errors.forbidden };
  refreshContact(contactId);
  return { status: "success" };
}

export async function saveSupplierPriceAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = supplierPriceSchema.safeParse({
    id: formString(formData, "id"),
    contactId: formString(formData, "contactId"),
    itemName: formString(formData, "itemName"),
    unit: formString(formData, "unit"),
    unitPrice: formString(formData, "unitPrice"),
    currencyCode: formString(formData, "currencyCode"),
    observedOn: formString(formData, "observedOn"),
    transactionId: formString(formData, "transactionId"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", v.currencyCode).maybeSingle();
  if (!currency) return { status: "error", fieldErrors: { currencyCode: m.errors.currency_invalid } };
  const price = parseAmountInput(v.unitPrice, currency.minor_unit);
  if (price === null) return { status: "error", fieldErrors: { unitPrice: m.errors.amount_invalid } };
  const fields = {
    item_name: v.itemName,
    unit: v.unit,
    unit_price_minor: Number(price),
    currency_code: v.currencyCode,
    observed_on: v.observedOn,
    transaction_id: v.transactionId,
    notes: v.notes,
  };
  const result = v.id
    ? await session.supabase.from("supplier_prices").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("supplier_prices").insert({ ...businessScopeFields(scope), contact_id: v.contactId, ...fields }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refreshContact(v.contactId);
  return { status: "success", message: m.business.contacts.priceSaved };
}

export async function deleteSupplierPriceAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("supplier_prices")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("contact_id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  const contactId = data?.[0]?.contact_id;
  if (!contactId) return { status: "error", message: m.errors.forbidden };
  refreshContact(contactId);
  return { status: "success" };
}
