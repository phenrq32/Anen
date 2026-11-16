"use server";

import { revalidatePath } from "next/cache";
import {
  accountSchema,
  budgetSchema,
  categorySchema,
  fieldErrors,
  goalSchema,
  parseAmountInput,
  recurringSchema,
  transactionSchema,
} from "@anen/validation";
import type { Messages } from "@anen/i18n";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { financeScope, scopeFields, type FinanceScope } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession, type SessionContext } from "@/lib/session";

const ok = (message?: string): FormState => ({ status: "success", ...(message ? { message } : {}) });

async function writableScope(): Promise<{ m: Messages; session: SessionContext; scope: FinanceScope } | { error: FormState }> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canWrite) return { error: { status: "error", message: m.errors.forbidden } };
  return { m, session, scope };
}

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/painel");
}

async function minorUnitFor(session: SessionContext, currency: string): Promise<number | null> {
  const { data } = await session.supabase.from("currencies").select("minor_unit").eq("code", currency).maybeSingle();
  return data?.minor_unit ?? null;
}

async function accountCurrency(session: SessionContext, accountId: string): Promise<{ currency: string; minorUnit: number } | null> {
  const { data } = await session.supabase.from("financial_accounts").select("currency_code").eq("id", accountId).maybeSingle();
  if (!data) return null;
  const minorUnit = await minorUnitFor(session, data.currency_code);
  return minorUnit === null ? null : { currency: data.currency_code, minorUnit };
}

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------
export async function saveAccountAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = accountSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    kind: formString(formData, "kind"),
    currencyCode: formString(formData, "currencyCode"),
    openingBalance: formString(formData, "openingBalance"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const unit = await minorUnitFor(session, v.currencyCode);
  if (unit === null) return { status: "error", fieldErrors: { currencyCode: m.errors.currency_invalid } };
  const opening = parseAmountInput(v.openingBalance, unit, { allowNegative: true });
  if (opening === null) return { status: "error", fieldErrors: { openingBalance: m.errors.amount_invalid } };

  const result = v.id
    ? await session.supabase
        .from("financial_accounts")
        .update({ name: v.name, kind: v.kind, currency_code: v.currencyCode, opening_balance_minor: Number(opening) })
        .eq("id", v.id)
        .eq(scope.column, scope.value)
        .select("id")
    : await session.supabase
        .from("financial_accounts")
        .insert({ ...scopeFields(scope), name: v.name, kind: v.kind, currency_code: v.currencyCode, opening_balance_minor: Number(opening) })
        .select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  return ok(m.settings.saved);
}

export async function toggleArchiveAccountAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const archive = formString(formData, "archive") === "1";
  const { error } = await session.supabase
    .from("financial_accounts")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Movimentos
// ---------------------------------------------------------------------------
export async function saveTransactionAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = transactionSchema.safeParse({
    id: formString(formData, "id"),
    kind: formString(formData, "kind"),
    amount: formString(formData, "amount"),
    occurredOn: formString(formData, "occurredOn"),
    accountId: formString(formData, "accountId"),
    categoryId: formString(formData, "categoryId"),
    description: formString(formData, "description"),
    counterparty: formString(formData, "counterparty"),
    notes: formString(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const account = await accountCurrency(session, v.accountId);
  if (!account) return { status: "error", fieldErrors: { accountId: m.errors.account_invalid } };
  const amount = parseAmountInput(v.amount, account.minorUnit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };

  const fields = {
    account_id: v.accountId,
    category_id: v.categoryId,
    kind: v.kind,
    amount_minor: Number(amount),
    occurred_on: v.occurredOn,
    description: v.description,
    counterparty: v.counterparty,
    notes: v.notes,
  };
  const result = v.id
    ? await session.supabase.from("transactions").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase
        .from("transactions")
        .insert({ ...scopeFields(scope), ...fields, currency_code: account.currency })
        .select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  return ok(v.id ? m.finance.tx.updated : m.finance.tx.saved);
}

export async function deleteTransactionAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase.from("transactions").delete().eq("id", formString(formData, "id")).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Recorrentes
// ---------------------------------------------------------------------------
export async function saveRecurringAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = recurringSchema.safeParse({
    kind: formString(formData, "kind"),
    amount: formString(formData, "amount"),
    accountId: formString(formData, "accountId"),
    categoryId: formString(formData, "categoryId"),
    description: formString(formData, "description"),
    frequency: formString(formData, "frequency"),
    intervalCount: formString(formData, "intervalCount") || "1",
    startOn: formString(formData, "startOn"),
    endOn: formString(formData, "endOn"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const account = await accountCurrency(session, v.accountId);
  if (!account) return { status: "error", fieldErrors: { accountId: m.errors.account_invalid } };
  const amount = parseAmountInput(v.amount, account.minorUnit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };
  const { error } = await session.supabase.from("recurring_transactions").insert({
    ...scopeFields(scope),
    account_id: v.accountId,
    category_id: v.categoryId,
    kind: v.kind,
    amount_minor: Number(amount),
    currency_code: account.currency,
    description: v.description,
    frequency: v.frequency,
    interval_count: v.intervalCount,
    start_on: v.startOn,
    end_on: v.endOn,
    next_run_on: v.startOn,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok(m.finance.recurring.saved);
}

export async function toggleRecurringAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase
    .from("recurring_transactions")
    .update({ is_active: formString(formData, "active") === "1" })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

export async function deleteRecurringAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase.from("recurring_transactions").delete().eq("id", formString(formData, "id")).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Orçamentos e objetivos
// ---------------------------------------------------------------------------
export async function saveBudgetAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = budgetSchema.safeParse({
    categoryId: formString(formData, "categoryId"),
    month: formString(formData, "month"),
    amount: formString(formData, "amount"),
    currencyCode: formString(formData, "currencyCode"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const unit = await minorUnitFor(session, v.currencyCode);
  const amount = unit === null ? null : parseAmountInput(v.amount, unit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };
  const periodStart = `${v.month}-01`;

  const existing = await session.supabase
    .from("budgets")
    .select("id")
    .eq(scope.column, scope.value)
    .eq("category_id", v.categoryId)
    .eq("period_start", periodStart)
    .eq("currency_code", v.currencyCode)
    .maybeSingle();
  const result = existing.data
    ? await session.supabase.from("budgets").update({ amount_minor: Number(amount) }).eq("id", existing.data.id)
    : await session.supabase.from("budgets").insert({
        ...scopeFields(scope),
        category_id: v.categoryId,
        period_start: periodStart,
        amount_minor: Number(amount),
        currency_code: v.currencyCode,
      });
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  refresh();
  return ok(m.finance.budget.saved);
}

export async function deleteBudgetAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase.from("budgets").delete().eq("id", formString(formData, "id")).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

export async function saveGoalAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = goalSchema.safeParse({
    id: formString(formData, "id"),
    name: formString(formData, "name"),
    target: formString(formData, "target"),
    saved: formString(formData, "saved"),
    currencyCode: formString(formData, "currencyCode"),
    targetDate: formString(formData, "targetDate"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const unit = await minorUnitFor(session, v.currencyCode);
  if (unit === null) return { status: "error", fieldErrors: { currencyCode: m.errors.currency_invalid } };
  const target = parseAmountInput(v.target, unit);
  const saved = parseAmountInput(v.saved, unit);
  if (target === null || target <= 0n) return { status: "error", fieldErrors: { target: m.errors.amount_invalid } };
  if (saved === null) return { status: "error", fieldErrors: { saved: m.errors.amount_invalid } };
  const fields = { name: v.name, target_minor: Number(target), saved_minor: Number(saved), target_date: v.targetDate };
  const result = v.id
    ? await session.supabase.from("savings_goals").update(fields).eq("id", v.id).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("savings_goals").insert({ ...scopeFields(scope), ...fields, currency_code: v.currencyCode }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  return ok(m.settings.saved);
}

export async function deleteGoalAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase.from("savings_goals").delete().eq("id", formString(formData, "id")).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export async function saveCategoryAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = categorySchema.safeParse({
    name: formString(formData, "name"),
    kind: formString(formData, "kind"),
    color: formString(formData, "color") || "#737373",
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { error } = await session.supabase.from("transaction_categories").insert({ ...scopeFields(scope), ...parsed.data });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok(m.finance.category.saved);
}

export async function archiveCategoryAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const { error } = await session.supabase
    .from("transaction_categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}
