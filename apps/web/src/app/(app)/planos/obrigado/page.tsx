import type { Metadata } from "next";
import { Alert, ButtonLink, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { confirmInfinitePay } from "@/lib/infinitepay";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Pagamento" };

/**
 * Regresso do checkout da InfinitePay: a InfinitePay junta transaction_nsu e slug ao endereço; confirma-se aqui
 * (também chega o aviso pelo webhook; o que vier primeiro ativa, o outro não repete).
 */
export default async function ThanksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const sp = await searchParams;
  const nsu = (sp.pedido ?? sp.order_nsu ?? "").slice(0, 40);
  let status = "unconfirmed";
  if (nsu && sp.transaction_nsu && sp.slug) status = await confirmInfinitePay(nsu, sp.transaction_nsu, sp.slug);
  if (status === "unconfirmed" && nsu) {
    // O webhook pode ter chegado antes: vê o estado do pedido (só os seus).
    const { data } = await session.supabase.from("billing_orders").select("status").eq("order_nsu", nsu).maybeSingle();
    if (data?.status === "paid") status = "paid";
  }
  const ok = status === "paid" || status === "already_paid";
  return (
    <>
      <PageHeader title={ok ? m.billing.thanksTitle : m.billing.pendingTitle} />
      <div className={ok ? "pop-in" : undefined}>
        <Alert tone={ok ? "success" : "info"}>{ok ? m.billing.thanksBody : m.billing.pendingBody}</Alert>
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={ok ? "/ia" : "/planos"}>{ok ? m.billing.tryAi : m.billing.backToPlans}</ButtonLink>
        <ButtonLink href="/painel" variant="secondary">
          {m.nav.dashboard}
        </ButtonLink>
      </div>
    </>
  );
}
