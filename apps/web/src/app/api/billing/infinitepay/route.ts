import { NextResponse } from "next/server";
import { confirmInfinitePay } from "@/lib/infinitepay";

/**
 * Aviso da InfinitePay quando um pedido é pago. O endereço leva um token (BILLING_WEBHOOK_TOKEN) e, mesmo assim,
 * nada é ativado sem confirmar o pagamento diretamente com a InfinitePay (confirmInfinitePay → payment_check).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = process.env.BILLING_WEBHOOK_TOKEN;
  if (!token || new URL(request.url).searchParams.get("token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (k: string) => (typeof body?.[k] === "string" || typeof body?.[k] === "number" ? String(body![k]) : "");
  const result = await confirmInfinitePay(str("order_nsu"), str("transaction_nsu"), str("invoice_slug") || str("slug"));
  // 200 mesmo quando não confirma: a InfinitePay não deve repetir sem fim; a página de retorno volta a verificar.
  return NextResponse.json({ result });
}
