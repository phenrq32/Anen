"use server";

import { revalidatePath } from "next/cache";
import {
  accountSchema,
  budgetSchema,
  categorySchema,
  costCenterSchema,
  fieldErrors,
  goalSchema,
  parseAmountInput,
  recurringEditSchema,
  recurringLinksSchema,
  recurringSchema,
  transactionSchema,
  periodDates,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
} from "@anen/validation";
import type { Messages } from "@anen/i18n";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { financeScope, scopeFields, todayIn, type FinanceScope } from "@/lib/finance";
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
  revalidatePath("/projetos", "layout");
  revalidatePath("/contactos", "layout");
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
    period: formString(formData, "period"),
    amount: formString(formData, "amount"),
    occurredOn: formString(formData, "occurredOn"),
    accountId: formString(formData, "accountId"),
    categoryId: formString(formData, "categoryId"),
    description: formString(formData, "description"),
    counterparty: formString(formData, "counterparty"),
    notes: formString(formData, "notes"),
    contactId: formString(formData, "contactId"),
    projectId: formString(formData, "projectId"),
    costCenterId: formString(formData, "costCenterId"),
    costKind: formString(formData, "costKind"),
    dueOn: formString(formData, "dueOn"),
    tax: formString(formData, "tax"),
    settlement: formString(formData, "settlement"),
    settled: formString(formData, "settled"),
    paymentMethod: formString(formData, "paymentMethod"),
    documentRef: formString(formData, "documentRef"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const account = await accountCurrency(session, v.accountId);
  if (!account) return { status: "error", fieldErrors: { accountId: m.errors.account_invalid } };
  const amount = parseAmountInput(v.amount, account.minorUnit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };

  // Detalhes só existem no formulário completo; o registo rápido não os envia e não os altera.
  const withDetails = formData.has("settlement");
  let details = {};
  if (withDetails) {
    let tax: bigint | null = null;
    if (v.tax) {
      tax = parseAmountInput(v.tax, account.minorUnit);
      if (tax === null || tax < 0n) return { status: "error", fieldErrors: { tax: m.errors.amount_invalid } };
      if (tax > amount) return { status: "error", fieldErrors: { tax: m.errors.tax_invalid } };
    }
    let settled = amount;
    if (v.settlement === "pending") settled = 0n;
    if (v.settlement === "partial") {
      const partial = v.settled ? parseAmountInput(v.settled, account.minorUnit) : null;
      if (partial === null || partial <= 0n || partial >= amount) return { status: "error", fieldErrors: { settled: m.errors.settled_invalid } };
      settled = partial;
    }
    details = {
      contact_id: v.contactId,
      project_id: v.projectId,
      cost_center_id: v.costCenterId,
      cost_kind: v.kind === "expense" ? v.costKind : null,
      due_on: v.dueOn,
      net_minor: tax === null ? null : Number(amount - tax),
      tax_minor: tax === null ? null : Number(tax),
      settled_minor: Number(settled),
      payment_method: v.paymentMethod,
      document_ref: v.documentRef,
    };
  }

  // Valor de um período: a data do movimento fica no fim do período (ou hoje, se ainda está a decorrer).
  let occurredOn = v.occurredOn;
  let periodFields = {};
  if (formData.has("period")) {
    if (v.period) {
      const p = periodDates(v.period, v.occurredOn, todayIn(scope.timezone));
      occurredOn = p.occurredOn;
      periodFields = { period_start: p.start, period_end: p.end };
    } else {
      periodFields = { period_start: null, period_end: null };
    }
  }
  const fields = {
    account_id: v.accountId,
    category_id: v.categoryId,
    kind: v.kind,
    amount_minor: Number(amount),
    occurred_on: occurredOn,
    ...periodFields,
    description: v.description,
    counterparty: v.counterparty,
    notes: v.notes,
    ...details,
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
  const id = formString(formData, "id");
  // Os ficheiros no Storage não são apagados em cascata: remover antes do movimento.
  const { data: files } = await session.supabase.from("transaction_attachments").select("storage_path").eq("transaction_id", id);
  if (files?.length) await session.supabase.storage.from(ATTACHMENTS_BUCKET).remove(files.map((f) => f.storage_path));
  const { error } = await session.supabase.from("transactions").delete().eq("id", id).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Anexos: o servidor valida e regista; o browser envia o ficheiro por URL assinado
// (direto para o Storage, sem passar pelo limite de tamanho das funções).
// ---------------------------------------------------------------------------
const ATTACHMENTS_BUCKET = "attachments";
const EXTENSIONS: Record<(typeof ATTACHMENT_MIME_TYPES)[number], string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export type PrepareAttachmentResult =
  | { ok: true; id: string; path: string; token: string }
  | { ok: false; message: string };

export async function prepareAttachmentAction(input: {
  transactionId: string;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<PrepareAttachmentResult> {
  const ctx = await writableScope();
  if ("error" in ctx) return { ok: false, message: ctx.error.message ?? "" };
  const { m, session, scope } = ctx;
  const mime = ATTACHMENT_MIME_TYPES.find((t) => t === input.mimeType);
  if (!mime) return { ok: false, message: m.finance.attachments.typeInvalid };
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > ATTACHMENT_MAX_BYTES) {
    return { ok: false, message: m.finance.attachments.tooLarge };
  }
  if (!/^[0-9a-f-]{36}$/.test(input.transactionId)) return { ok: false, message: m.errors.forbidden };
  const { data: tx } = await session.supabase
    .from("transactions")
    .select("id")
    .eq("id", input.transactionId)
    .eq(scope.column, scope.value)
    .maybeSingle();
  if (!tx) return { ok: false, message: m.errors.forbidden };

  // Nome guardado só para mostrar; o caminho usa um identificador aleatório.
  const fileName = input.fileName.replace(/[\u0000-\u001f\\/]/g, "_").trim().slice(0, 200) || `anexo.${EXTENSIONS[mime]}`;
  const path = `${scope.value}/${tx.id}/${crypto.randomUUID()}.${EXTENSIONS[mime]}`;
  const { data: row, error } = await session.supabase
    .from("transaction_attachments")
    .insert({ transaction_id: tx.id, storage_path: path, file_name: fileName, mime_type: mime, size_bytes: input.size })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: errorMessage(m, error) };
  const signed = await session.supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    await session.supabase.from("transaction_attachments").delete().eq("id", row.id);
    return { ok: false, message: m.errors.generic };
  }
  return { ok: true, id: row.id, path, token: signed.data.token };
}

/** Confirma o envio (o ficheiro tem de existir) ou desfaz o registo se o envio falhou. */
export async function finishAttachmentAction(input: { id: string; uploaded: boolean }): Promise<{ ok: boolean; message?: string }> {
  const ctx = await writableScope();
  if ("error" in ctx) return { ok: false, message: ctx.error.message ?? "" };
  const { m, session } = ctx;
  const { data: row } = await session.supabase.from("transaction_attachments").select("id, storage_path").eq("id", input.id).maybeSingle();
  if (!row) return { ok: false, message: m.errors.forbidden };
  const [folder, file] = [row.storage_path.slice(0, row.storage_path.lastIndexOf("/")), row.storage_path.slice(row.storage_path.lastIndexOf("/") + 1)];
  const { data: listed } = input.uploaded
    ? await session.supabase.storage.from(ATTACHMENTS_BUCKET).list(folder, { search: file, limit: 1 })
    : { data: [] };
  if (!listed?.some((o) => o.name === file)) {
    await session.supabase.from("transaction_attachments").delete().eq("id", row.id);
    return { ok: false, message: m.errors.generic };
  }
  refresh();
  return { ok: true };
}

export async function deleteAttachmentAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session } = ctx;
  const { data: row } = await session.supabase
    .from("transaction_attachments")
    .select("id, storage_path")
    .eq("id", formString(formData, "id"))
    .maybeSingle();
  if (!row) return { status: "error", message: m.errors.forbidden };
  const removed = await session.supabase.storage.from(ATTACHMENTS_BUCKET).remove([row.storage_path]);
  if (removed.error) return { status: "error", message: m.errors.generic };
  const { error } = await session.supabase.from("transaction_attachments").delete().eq("id", row.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

/** Marca um movimento pendente ou parcial como totalmente liquidado. */
export async function markSettledAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const id = formString(formData, "id");
  const { data: tx } = await session.supabase.from("transactions").select("amount_minor").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  if (!tx) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("transactions").update({ settled_minor: tx.amount_minor }).eq("id", id).eq(scope.column, scope.value);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Centros de custo (permissão business.write)
// ---------------------------------------------------------------------------
export async function saveCostCenterAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = costCenterSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { error } = await session.supabase.from("cost_centers").insert({ ...businessScopeFields(scope), name: parsed.data.name });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok(m.finance.costCenters.saved);
}

export async function archiveCostCenterAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase
    .from("cost_centers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", formString(formData, "id"))
    .eq(scope.column, scope.value);
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
  const links = recurringLinksSchema.safeParse(recurringLinkFields(formData));
  if (!links.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(links.error)) };
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
    ...recurringLinkColumns(links.data, v.kind),
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return ok(m.finance.recurring.saved);
}

function recurringLinkFields(formData: FormData) {
  return {
    contactId: formString(formData, "contactId"),
    projectId: formString(formData, "projectId"),
    costCenterId: formString(formData, "costCenterId"),
    costKind: formString(formData, "costKind"),
    generatePending: formString(formData, "generatePending"),
    dueDays: formString(formData, "dueDays"),
  };
}

function recurringLinkColumns(
  v: { contactId: string | null; projectId: string | null; costCenterId: string | null; costKind: string | null; generatePending: boolean; dueDays: number | null },
  kind: "income" | "expense",
) {
  return {
    contact_id: v.contactId,
    project_id: v.projectId,
    cost_center_id: v.costCenterId,
    cost_kind: kind === "expense" ? (v.costKind as "material" | "labor" | "travel" | "equipment" | "overhead" | "other" | null) : null,
    generate_pending: v.generatePending,
    due_days: v.dueDays,
  };
}

/** Edição de uma recorrência: valor, descrição, categoria, fim e ligações (o calendário não muda). */
export async function updateRecurringAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writableScope();
  if ("error" in ctx) return ctx.error;
  const { m, session, scope } = ctx;
  const parsed = recurringEditSchema.safeParse({
    id: formString(formData, "id"),
    amount: formString(formData, "amount"),
    categoryId: formString(formData, "categoryId"),
    description: formString(formData, "description"),
    endOn: formString(formData, "endOn"),
    ...recurringLinkFields(formData),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data: current } = await session.supabase
    .from("recurring_transactions")
    .select("account_id, kind, start_on")
    .eq("id", v.id)
    .eq(scope.column, scope.value)
    .maybeSingle();
  if (!current) return { status: "error", message: m.errors.forbidden };
  if (v.endOn && v.endOn < current.start_on) return { status: "error", fieldErrors: { endOn: m.errors.date_invalid } };
  const account = await accountCurrency(session, current.account_id);
  if (!account) return { status: "error", message: m.errors.account_invalid };
  const amount = parseAmountInput(v.amount, account.minorUnit);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };
  const { data, error } = await session.supabase
    .from("recurring_transactions")
    .update({
      amount_minor: Number(amount),
      description: v.description,
      category_id: v.categoryId,
      end_on: v.endOn,
      ...recurringLinkColumns(v, current.kind),
    })
    .eq("id", v.id)
    .eq(scope.column, scope.value)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  refresh();
  return ok(m.finance.recurring.updated);
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
