"use server";

import { redirect } from "next/navigation";
import { format } from "@anen/i18n";
import { getPublicEnv } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { createCheckoutLink, infinitePayHandle } from "@/lib/infinitepay";
import { can, requireOnboardedSession } from "@/lib/session";

/** Começa o pagamento de um plano no Brasil: cria o pedido (preço vem da base de dados) e abre o checkout. */
export async function startCheckoutAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const plan = formString(formData, "plan");
  const months = Number(formString(formData, "months"));
  if (!["pro", "max"].includes(plan) || ![1, 12].includes(months)) return { status: "error", message: m.errors.generic };
  const org = session.active?.organization.id ?? null;
  if (session.active && !can(session.active, "organization.update")) return { status: "error", message: m.billing.orgOwnersOnly };
  const env = getPublicEnv();
  const token = process.env.BILLING_WEBHOOK_TOKEN;
  if (!infinitePayHandle() || !env || !token) return { status: "error", message: m.billing.unavailable };

  const { data, error } = await session.supabase.rpc("create_billing_order", {
    p_org: org,
    p_plan: plan,
    p_months: months,
    p_currency: "BRL",
    p_provider: "infinitepay",
  });
  const order = data?.[0];
  if (error || !order) return { status: "error", message: errorMessage(m, error) };
  const url = await createCheckoutLink({
    orderNsu: order.order_nsu,
    description: format(m.billing.checkoutItem, { plan: plan === "max" ? "Max" : "Pro", months }),
    amountMinor: BigInt(order.amount_minor),
    redirectUrl: `${env.siteUrl}/planos/obrigado?pedido=${order.order_nsu}`,
    webhookUrl: `${env.siteUrl}/api/billing/infinitepay?token=${token}`,
  });
  if (!url) return { status: "error", message: m.billing.checkoutFailed };
  redirect(url);
}
