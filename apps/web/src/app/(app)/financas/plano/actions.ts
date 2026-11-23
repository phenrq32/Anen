"use server";

import { revalidatePath } from "next/cache";
import { fieldErrors, fixedExpenseSchema, monthlyPlanSchema, parseAmountInput } from "@anen/validation";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession, type SessionContext } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

/** O plano do mês é sempre pessoal: o dono é o utilizador da sessão, a moeda a das suas preferências. */
async function personal(): Promise<{ session: SessionContext; currency: string; minorUnit: number } | { error: FormState }> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  if (session.active) return { error: { status: "error", message: m.finance.plan.orgNote } };
  const currency = session.preferences.currency_code;
  const { data } = await session.supabase.from("currencies").select("minor_unit").eq("code", currency).maybeSingle();
  if (!data) return { error: { status: "error", message: m.errors.currency_invalid } };
  return { session, currency, minorUnit: data.minor_unit };
}

function refresh() {
  revalidatePath("/financas/plano");
}

export async function savePlanAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const ctx = await personal();
  if ("error" in ctx) return ctx.error;
  const { session, currency, minorUnit } = ctx;
  const parsed = monthlyPlanSchema.safeParse({
    month: formString(formData, "month"),
    salary: formString(formData, "salary"),
    reserve: formString(formData, "reserve"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const salary = parseAmountInput(parsed.data.salary, minorUnit);
  const reserve = parseAmountInput(parsed.data.reserve, minorUnit);
  if (salary === null || salary < 0n) return { status: "error", fieldErrors: { salary: m.errors.amount_invalid } };
  if (reserve === null || reserve < 0n) return { status: "error", fieldErrors: { reserve: m.errors.amount_invalid } };

  const month = `${parsed.data.month}-01`;
  const { data: existing } = await session.supabase.from("monthly_plans").select("id").eq("owner_user_id", session.user.id).eq("month", month).maybeSingle();
  const result = existing
    ? await session.supabase
        .from("monthly_plans")
        .update({ salary_minor: Number(salary), emergency_reserve_minor: Number(reserve), currency_code: currency })
        .eq("id", existing.id)
    : await session.supabase.from("monthly_plans").insert({
        owner_user_id: session.user.id,
        month,
        currency_code: currency,
        salary_minor: Number(salary),
        emergency_reserve_minor: Number(reserve),
      });
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  refresh();
  return { status: "success", message: m.finance.plan.saved };
}

export async function saveFixedExpenseAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const ctx = await personal();
  if ("error" in ctx) return ctx.error;
  const { session, currency, minorUnit } = ctx;
  const parsed = fixedExpenseSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    amount: formString(formData, "amount"),
    categoryId: formString(formData, "categoryId"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const amount = parseAmountInput(v.amount, minorUnit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };

  const result = v.id
    ? await session.supabase
        .from("fixed_expenses")
        .update({ name: v.name, amount_minor: Number(amount), ...(formData.has("categoryId") ? { category_id: v.categoryId } : {}) })
        .eq("id", v.id)
        .eq("owner_user_id", session.user.id)
        .select("id")
    : await session.supabase
        .from("fixed_expenses")
        .insert({ owner_user_id: session.user.id, name: v.name, amount_minor: Number(amount), currency_code: currency, category_id: v.categoryId })
        .select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  // Na edição em linha, a mudança do total já confirma; a mensagem fica para a criação.
  return v.id ? { status: "success" } : { status: "success", message: m.finance.plan.fixedSaved };
}

export async function deleteFixedExpenseAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const ctx = await personal();
  if ("error" in ctx) return ctx.error;
  const { error } = await ctx.session.supabase
    .from("fixed_expenses")
    .delete()
    .eq("id", formString(formData, "id"))
    .eq("owner_user_id", ctx.session.user.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success" };
}
