"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrors, parseAmountInput, projectSchema } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

function refresh() {
  revalidatePath("/projetos", "layout");
  revalidatePath("/painel");
  revalidatePath("/orcamentos", "layout");
}

export async function saveProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = projectSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    clientContactId: formString(formData, "clientContactId"),
    status: formString(formData, "status"),
    currencyCode: formString(formData, "currencyCode"),
    plannedCost: formString(formData, "plannedCost"),
    plannedRevenue: formString(formData, "plannedRevenue"),
    startOn: formString(formData, "startOn"),
    endOn: formString(formData, "endOn"),
    description: formString(formData, "description"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", v.currencyCode).maybeSingle();
  if (!currency) return { status: "error", fieldErrors: { currencyCode: m.errors.currency_invalid } };
  const cost = parseAmountInput(v.plannedCost, currency.minor_unit);
  const revenue = parseAmountInput(v.plannedRevenue, currency.minor_unit);
  if (cost === null || cost < 0n) return { status: "error", fieldErrors: { plannedCost: m.errors.amount_invalid } };
  if (revenue === null || revenue < 0n) return { status: "error", fieldErrors: { plannedRevenue: m.errors.amount_invalid } };

  const fields = {
    name: v.name,
    description: v.description,
    client_contact_id: v.clientContactId,
    status: v.status,
    planned_cost_minor: Number(cost),
    planned_revenue_minor: Number(revenue),
    start_on: v.startOn,
    end_on: v.endOn,
    notes: v.notes,
  };
  const result = v.id
    ? await session.supabase.from("projects").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("projects").insert({ ...businessScopeFields(scope), ...fields, currency_code: v.currencyCode }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  const id = result.data?.[0]?.id;
  if (!id) return { status: "error", message: m.errors.forbidden };
  refresh();
  if (!v.id) redirect(`/projetos/${id}`);
  return { status: "success", message: m.business.projects.saved };
}

export async function deleteProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase
    .from("projects")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  redirect("/projetos");
}

export async function createProjectFromQuoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  if (!businessScope(session).canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase.rpc("create_project_from_quote", { p_quote_id: formString(formData, "quoteId") });
  if (error || !data) return { status: "error", message: errorMessage(m, error) };
  refresh();
  redirect(`/projetos/${data}`);
}
