import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { findCheckoutUrl } from "@/lib/checkout-url";

/**
 * Checkout Integrado da InfinitePay (Brasil): link de pagamento por Pix ou cartão, e verificação do pagamento.
 * Doc: https://www.infinitepay.io/checkout-documentacao. Só precisa da InfiniteTag (INFINITEPAY_HANDLE).
 * O aviso (webhook) não é assinado: só se ativa um plano depois de payment_check confirmar pago e o valor.
 */
const API = "https://api.checkout.infinitepay.io";

export function infinitePayHandle(): string | null {
  const h = (process.env.INFINITEPAY_HANDLE ?? "").replace(/^\$/, "").trim();
  return h || null;
}

export async function createCheckoutLink(input: {
  orderNsu: string;
  description: string;
  amountMinor: bigint;
  redirectUrl: string;
  webhookUrl: string;
}): Promise<string | null> {
  const handle = infinitePayHandle();
  if (!handle) return null;
  const res = await fetch(`${API}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      order_nsu: input.orderNsu,
      redirect_url: input.redirectUrl,
      webhook_url: input.webhookUrl,
      items: [{ quantity: 1, price: Number(input.amountMinor), description: input.description.slice(0, 120) }],
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return findCheckoutUrl(await res.json().catch(() => null));
}

/** Pergunta à InfinitePay se o pedido foi pago e quanto. */
export async function paymentCheck(orderNsu: string, transactionNsu: string, slug: string): Promise<{ paid: boolean; paidMinor: number } | null> {
  const handle = infinitePayHandle();
  if (!handle) return null;
  const res = await fetch(`${API}/payment_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as { paid?: boolean; paid_amount?: number; amount?: number } | null;
  if (!data) return null;
  const paidMinor = Number(data.paid_amount ?? data.amount ?? 0);
  return { paid: data.paid === true, paidMinor: Number.isFinite(paidMinor) ? paidMinor : 0 };
}

/**
 * Confirma um pagamento da InfinitePay e, se pago, ativa o plano (billing_confirm com o segredo próprio).
 * Devolve o resultado da base de dados ('paid', 'already_paid', 'rejected', 'not_found') ou 'unconfirmed'.
 */
export async function confirmInfinitePay(orderNsu: string, transactionNsu: string, slug: string): Promise<string> {
  const env = getPublicEnv();
  const secret = process.env.BILLING_SECRET;
  if (!env || !secret || !/^anen-[0-9A-F]{12}$/.test(orderNsu) || !transactionNsu || !slug) return "unconfirmed";
  const check = await paymentCheck(orderNsu, transactionNsu.slice(0, 120), slug.slice(0, 120));
  if (!check || !check.paid) return "unconfirmed";
  const db = createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("billing_confirm", {
    p_secret: secret,
    p_order_nsu: orderNsu,
    p_paid_minor: check.paidMinor,
    p_ref: `${transactionNsu}:${slug}`.slice(0, 200),
  });
  return error ? "unconfirmed" : String(data);
}
