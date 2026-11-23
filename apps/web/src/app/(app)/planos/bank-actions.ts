"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { can, requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

/** Portugal: cria o pedido por transferência (valor da tabela de preços) e mostra o IBAN com a referência. */
export async function startBankTransferAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const plan = formString(formData, "plan");
  const months = Number(formString(formData, "months"));
  if (!["pro", "max"].includes(plan) || ![1, 12].includes(months)) return { status: "error", message: m.errors.generic };
  if (session.active && !can(session.active, "organization.update")) return { status: "error", message: m.billing.orgOwnersOnly };
  if (!process.env.BILLING_IBAN) return { status: "error", message: m.billing.unavailable };
  const { data, error } = await session.supabase.rpc("create_billing_order", {
    p_org: session.active?.organization.id ?? null,
    p_plan: plan,
    p_months: months,
    p_currency: "EUR",
    p_provider: "bank_transfer",
  });
  const order = data?.[0];
  if (error || !order) return { status: "error", message: errorMessage(m, error) };
  redirect(`/planos/transferencia?pedido=${order.order_nsu}`);
}

/** Administrador da plataforma: confirma uma transferência recebida (ativa o plano). */
export async function confirmTransferAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { error } = await session.supabase.rpc("admin_confirm_billing", { p_order_id: formString(formData, "id") });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/planos/admin");
  return { status: "success", message: m.billing.admin.confirmed };
}
