"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contactSchema, fieldErrors } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

function refresh() {
  revalidatePath("/contactos", "layout");
  revalidatePath("/financas", "layout");
  revalidatePath("/projetos", "layout");
}

export async function saveContactAction(_: FormState, formData: FormData): Promise<FormState> {
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
