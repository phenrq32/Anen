"use server";

import { revalidatePath } from "next/cache";
import { crossWorkspaceTransferSchema, fieldErrors, parseAmountInput } from "@anen/validation";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { financeScope } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

function refresh() {
  revalidatePath("/financas", "layout");
  revalidatePath("/painel");
}

/**
 * Dual Workspace · Fase 7: cria a transferência entre o espaço ativo e outro. A base de dados confirma as permissões
 * nos dois lados, cria os dois movimentos numa só operação e ignora pedidos repetidos (clientRef).
 */
export async function createTransferAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const parsed = crossWorkspaceTransferSchema.safeParse({
    clientRef: formString(formData, "clientRef"),
    direction: formString(formData, "direction"),
    other: formString(formData, "other"),
    thisAccountId: formString(formData, "thisAccountId"),
    otherAccountId: formString(formData, "otherAccountId"),
    thisCategoryId: formString(formData, "thisCategoryId"),
    otherCategoryId: formString(formData, "otherCategoryId"),
    amount: formString(formData, "amount"),
    date: formString(formData, "date"),
    type: formString(formData, "type"),
    description: formString(formData, "description"),
    confirmed: formString(formData, "confirmed"),
  });
  if (!parsed.success) {
    const errors = translateFieldErrors(m, fieldErrors(parsed.error));
    return errors.confirmed ? { status: "error", message: errors.confirmed } : { status: "error", fieldErrors: errors };
  }
  const v = parsed.data;
  const { data: account } = await session.supabase.from("financial_accounts").select("currency_code").eq("id", v.thisAccountId).maybeSingle();
  if (!account) return { status: "error", fieldErrors: { thisAccountId: m.errors.account_invalid } };
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", account.currency_code).maybeSingle();
  const amount = parseAmountInput(v.amount, currency?.minor_unit ?? 2);
  if (amount === null || amount <= 0n) return { status: "error", fieldErrors: { amount: m.errors.amount_invalid } };

  const [otherType, otherId] = v.other.split(":") as ["PERSONAL" | "BUSINESS", string];
  const here = { type: session.active ? ("BUSINESS" as const) : ("PERSONAL" as const), id: session.active?.organization.id ?? session.user.id };
  const there = { type: otherType, id: otherId };
  const out = v.direction === "out";
  const source = out ? { ...here, account: v.thisAccountId, category: v.thisCategoryId } : { ...there, account: v.otherAccountId, category: v.otherCategoryId };
  const destination = out ? { ...there, account: v.otherAccountId, category: v.otherCategoryId } : { ...here, account: v.thisAccountId, category: v.thisCategoryId };
  const { error } = await session.supabase.rpc("create_cross_workspace_transfer", {
    p: {
      client_ref: v.clientRef,
      source_type: source.type,
      source_id: source.id,
      source_account_id: source.account,
      source_category_id: source.category ?? null,
      destination_type: destination.type,
      destination_id: destination.id,
      destination_account_id: destination.account,
      destination_category_id: destination.category ?? null,
      amount_minor: amount.toString(),
      transfer_date: v.date,
      transfer_type: v.type,
      description: v.description,
    },
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success", message: m.finance.transfers.created };
}

export async function revertTransferAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const id = formString(formData, "id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { status: "error", message: m.errors.generic };
  const reason = formString(formData, "reason").trim().slice(0, 200);
  const { error } = await session.supabase.rpc("revert_cross_workspace_transfer", { p_id: id, p_reason: reason || null });
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success", message: m.finance.transfers.reverted };
}
