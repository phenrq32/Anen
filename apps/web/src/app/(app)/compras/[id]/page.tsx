import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { PurchaseOrder, PurchaseOrderItem } from "@anen/types";
import { Alert, Badge, Section } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { formatQuantity } from "../../inventario/quantity";
import {
  AddPurchaseLineForm,
  DeleteOrderButton,
  PurchaseOrderDetailsForm,
  ReceiveForm,
  RemoveLineButton,
  StatusButton,
} from "../purchase-forms";
import { statusTone } from "../status";

export const metadata: Metadata = { title: "Encomenda" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const fin = financeScope(session);
  const t = m.purchases;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!scope.canRead) return <Alert tone="info">{t.noPermission}</Alert>;

  const { data } = await session.supabase.from("purchase_orders").select("*").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  const order: PurchaseOrder | null = data;
  if (!order) notFound();
  const editable = order.status === "draft" || order.status === "ordered";

  const [linesRes, suppliersRes, projectsRes, stockRes, accountsRes, currenciesRes] = await Promise.all([
    session.supabase.from("purchase_order_items").select("*").eq("order_id", id).order("position").order("id"),
    session.supabase.from("contacts").select("id, name, archived_at").eq(scope.column, scope.value).in("kind", ["supplier", "both"]).order("name").limit(1000),
    session.supabase.from("projects").select("id, name, currency_code, status").eq(scope.column, scope.value).order("created_at", { ascending: false }).limit(300),
    session.supabase.from("stock_items").select("id, name, unit").eq(scope.column, scope.value).eq("currency_code", order.currency_code).is("archived_at", null).order("name"),
    editable && fin.canWrite
      ? session.supabase.from("financial_accounts").select("id, name").eq(fin.column, fin.value).eq("currency_code", order.currency_code).is("archived_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    session.supabase.from("currencies").select("code, minor_unit, is_enabled").order("code"),
  ]);
  const lines: PurchaseOrderItem[] = linesRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];
  const supplier = suppliers.find((s) => s.id === order.supplier_id);
  const currencies = currenciesRes.data ?? [];
  const minorUnit = currencies.find((c) => c.code === order.currency_code)?.minor_unit ?? 2;
  const fmt = (v: bigint) => formatMoney(v, order.currency_code, minorUnit, locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const accounts = accountsRes.data ?? [];
  const financeNote = !fin.canWrite ? t.receive.noFinance : accounts.length === 0 ? t.receive.noAccounts : null;
  const zeroPrice = lines.some((l) => l.unit_price_minor === 0);
  const project = projectsRes.data?.find((p) => p.id === order.project_id);
  const a = t.actions;

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link href="/compras" className="text-sm text-muted hover:text-paper">← {t.back}</Link>
          <h1 className="flex flex-wrap items-center gap-3 break-words text-2xl font-bold sm:text-[28px]">
            {supplier?.name ?? t.supplierDeleted}
            <Badge tone={statusTone(order.status)}>{t.statuses[order.status]}</Badge>
          </h1>
          <p className="text-sm text-subtle">
            {[
              order.ordered_on ? `${t.fields.orderedOn}: ${day(order.ordered_on)}` : null,
              order.expected_on ? `${t.fields.expectedOn}: ${day(order.expected_on)}` : null,
              order.received_on ? format(t.receivedOn, { date: day(order.received_on) }) : null,
              project ? `${t.fields.project}: ${project.name}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || order.currency_code}
          </p>
        </div>
        {scope.canWrite ? (
          <div className="flex flex-wrap gap-2">
            {order.status === "draft" ? <StatusButton m={m} id={order.id} status="ordered" label={a.order} variant="primary" /> : null}
            {order.status === "ordered" ? <StatusButton m={m} id={order.id} status="draft" label={a.backToDraft} /> : null}
            {editable ? <StatusButton m={m} id={order.id} status="cancelled" label={a.cancel} confirmMessage={a.confirmCancel} variant="ghost" /> : null}
            {order.status === "cancelled" ? <StatusButton m={m} id={order.id} status="draft" label={a.reopen} /> : null}
            {order.status === "draft" || order.status === "cancelled" ? <DeleteOrderButton m={m} id={order.id} /> : null}
          </div>
        ) : null}
      </header>

      {order.transaction_id && fin.canRead ? (
        <Alert tone="info">
          <Link href={`/financas/movimentos?tipo=expense&mes=${(order.received_on ?? "").slice(0, 7)}&q=${encodeURIComponent(supplier?.name ?? "")}`} className="underline hover:text-paper">{t.viewExpense}</Link>
        </Alert>
      ) : null}

      <Section title={t.lines.title}>
        <div className="flex flex-col gap-6">
          {lines.length === 0 ? (
            <p className="text-sm text-muted">{t.lines.empty}</p>
          ) : (
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-left text-subtle">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{t.lines.description}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.lines.quantity}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.lines.unitPrice}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.lines.total}</th>
                    {scope.canWrite && editable ? <th scope="col" className="px-5 py-2.5 sm:px-6"><span className="sr-only">{t.lines.remove}</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-line align-middle last:border-0">
                      <td className="px-5 py-2.5 sm:px-6">
                        <span className="flex flex-col gap-0.5">
                          <span className="break-words">{l.description}</span>
                          {l.stock_item_id ? (
                            <Link href={`/inventario/${l.stock_item_id}`} className="text-xs text-muted hover:text-brand">{t.lines.entersStock}</Link>
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatQuantity(l.quantity, locale)}{l.unit ? ` ${l.unit}` : ""}</td>
                      <td className="tabular px-3 py-2.5 text-right">{l.unit_price_minor === 0 ? <span className="text-danger">{t.lines.zeroPrice}</span> : fmt(BigInt(l.unit_price_minor))}</td>
                      <td className="tabular px-3 py-2.5 text-right font-semibold">{fmt(BigInt(l.total_minor))}</td>
                      {scope.canWrite && editable ? (
                        <td className="px-5 py-1.5 text-right sm:px-6"><RemoveLineButton m={m} id={l.id} /></td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <th scope="row" colSpan={3} className="px-5 py-3 text-right font-medium text-muted sm:px-6">{t.lines.total}</th>
                    <td className="tabular px-3 py-3 text-right text-base font-bold">{fmt(BigInt(order.total_minor))}</td>
                    {scope.canWrite && editable ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {scope.canWrite && editable ? <AddPurchaseLineForm m={m} orderId={order.id} stockItems={stockRes.data ?? []} /> : null}
        </div>
      </Section>

      {scope.canWrite && editable && lines.length > 0 ? (
        <Section title={t.receive.title} description={t.receive.description}>
          <div className="flex flex-col gap-4">
            {zeroPrice ? <Alert tone="info">{t.receive.zeroPriceWarning}</Alert> : null}
            <ReceiveForm m={m} orderId={order.id} today={todayIn(scope.timezone)} accounts={accounts} financeNote={financeNote} />
          </div>
        </Section>
      ) : null}

      {scope.canWrite && editable ? (
        <Section title={t.details}>
          <PurchaseOrderDetailsForm
            m={m}
            order={order}
            suppliers={suppliers.filter((s) => !s.archived_at || s.id === order.supplier_id)}
            projects={(projectsRes.data ?? []).map((p) => ({ id: p.id, name: p.name, currency: p.currency_code }))}
            currencies={currencies.filter((c) => c.is_enabled).map((c) => c.code)}
            hasLines={lines.length > 0}
          />
        </Section>
      ) : order.notes ? (
        <Section title={t.fields.notes}>
          <p className="whitespace-pre-line break-words text-sm">{order.notes}</p>
        </Section>
      ) : null}
    </>
  );
}
