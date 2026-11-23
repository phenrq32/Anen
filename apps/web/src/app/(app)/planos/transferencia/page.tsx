import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format, formatMoney } from "@anen/i18n";
import { CopyField } from "@/components/forms";
import { Alert, ButtonLink, PageHeader, Section } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Pagamento por transferência" };

/** Dados para a transferência (IBAN da ANEN, valor e referência do pedido). O plano ativa quando a ANEN confirmar. */
export default async function TransferPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const nsu = ((await searchParams).pedido ?? "").slice(0, 40);
  const { data: order } = await session.supabase.from("billing_orders").select("*").eq("order_nsu", nsu).eq("provider", "bank_transfer").maybeSingle();
  if (!order) notFound();
  const t = m.billing.transfer;
  const iban = (process.env.BILLING_IBAN ?? "").replace(/\s+/g, " ").trim();
  const holder = process.env.BILLING_IBAN_NAME?.trim();
  const amount = formatMoney(BigInt(order.amount_minor), order.currency_code, 2, locale);
  return (
    <>
      <PageHeader title={t.title} description={format(t.description, { plan: order.plan_key === "max" ? "Max" : "Pro", months: order.months })} />
      {order.status === "paid" ? <Alert tone="success">{m.billing.thanksBody}</Alert> : null}
      <Section title={t.details}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t.amount}</span>
            <span className="tabular font-heading text-3xl font-extrabold text-brand">{amount}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">{t.iban}</span>
            <CopyField value={iban} copyLabel={m.common.copy} copiedLabel={m.common.copied} />
          </div>
          {holder ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">{t.holder}</span>
              <span className="font-medium">{holder}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">{t.reference}</span>
            <CopyField value={order.order_nsu} copyLabel={m.common.copy} copiedLabel={m.common.copied} />
            <p className="text-xs text-subtle">{t.referenceHint}</p>
          </div>
        </div>
      </Section>
      <Alert tone="info">{t.after}</Alert>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/planos" variant="secondary">
          {m.billing.backToPlans}
        </ButtonLink>
      </div>
    </>
  );
}
