import type { Metadata } from "next";
import Link from "next/link";
import { compareSupplierPrices } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { PURCHASE_STATUSES, type PurchaseOrder, type SupplierPrice } from "@anen/types";
import { Alert, Badge, PageHeader, Section, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { NewPurchaseOrderForm } from "./purchase-forms";
import { statusTone } from "./status";

export const metadata: Metadata = { title: "Compras" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const t = m.purchases;
  if (!scope.canRead) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const status = PURCHASE_STATUSES.find((s) => s === params.estado) ?? null;
  // Resumo da reposição automática (vindo do inventário): "pedidos-linhas-sem fornecedor".
  const reorder = /^(\d{1,4})-(\d{1,5})-(\d{1,5})$/.exec(params.reposicao ?? "");
  const r = m.inventory.reorder;
  const reorderMessage = reorder
    ? [
        Number(reorder[1]) > 0 ? format(r.created, { orders: reorder[1]!, lines: reorder[2]! }) : r.nothing,
        Number(reorder[3]) > 0 ? format(r.skipped, { skipped: reorder[3]! }) : "",
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  let ordersQuery = session.supabase.from("purchase_orders").select("*").eq(scope.column, scope.value).order("created_at", { ascending: false }).limit(300);
  if (status) ordersQuery = ordersQuery.eq("status", status);
  const [ordersRes, suppliersRes, pricesRes, currenciesRes] = await Promise.all([
    ordersQuery,
    session.supabase.from("contacts").select("id, name, archived_at").eq(scope.column, scope.value).in("kind", ["supplier", "both"]).order("name").limit(1000),
    session.supabase.from("supplier_prices").select("*").eq(scope.column, scope.value).order("observed_on", { ascending: false }).limit(5000),
    session.supabase.from("currencies").select("code, minor_unit, is_enabled").order("code"),
  ]);
  if (ordersRes.error) throw new Error("Falha ao carregar as compras");
  const orders: PurchaseOrder[] = ordersRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const prices: SupplierPrice[] = pricesRes.data ?? [];
  const currencies = currenciesRes.data ?? [];
  const minorUnits = new Map(currencies.map((c) => [c.code, c.minor_unit]));
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });

  const comparisons = compareSupplierPrices(
    prices
      .filter((p) => supplierName.has(p.contact_id))
      .map((p) => ({
        id: p.id,
        itemName: p.item_name,
        unit: p.unit,
        unitPriceMinor: BigInt(p.unit_price_minor),
        currency: p.currency_code,
        observedOn: p.observed_on,
        createdAt: p.created_at,
        supplierId: p.contact_id,
        supplierName: supplierName.get(p.contact_id) ?? "",
      })),
  );

  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");
  const activeSuppliers = suppliers.filter((s) => !s.archived_at);

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {!scope.canWrite ? <Alert tone="info">{t.readOnly}</Alert> : null}
      {reorderMessage ? <Alert tone="success">{reorderMessage}</Alert> : null}

      {scope.canWrite ? (
        <Section title={t.new}>
          {activeSuppliers.length === 0 ? (
            <p className="text-sm text-muted">
              <Link href="/contactos?tipo=supplier" className="underline hover:text-paper">{t.noSuppliers}</Link>
            </p>
          ) : (
            <NewPurchaseOrderForm
              m={m}
              suppliers={activeSuppliers}
              currencies={currencies.filter((c) => c.is_enabled).map((c) => c.code)}
              defaultCurrency={scope.defaultCurrency}
            />
          )}
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/compras" className={chip(!status)}>{t.all}</Link>
        {PURCHASE_STATUSES.map((s) => (
          <Link key={s} href={`/compras?estado=${s}`} className={chip(status === s)}>{t.statuses[s]}</Link>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-surface">
        {orders.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">{t.empty}</p>
        ) : (
          <ul className="flex flex-col" aria-label={t.title}>
            {orders.map((o) => (
              <li key={o.id} className="border-b border-line last:border-0">
                <Link href={`/compras/${o.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-graphite/50 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{(o.supplier_id && supplierName.get(o.supplier_id)) || t.supplierDeleted}</span>
                    <span className="block truncate text-xs text-subtle">
                      {o.received_on ? format(t.receivedOn, { date: day(o.received_on) }) : day(o.ordered_on ?? o.created_at.slice(0, 10))}
                    </span>
                  </span>
                  <Badge tone={statusTone(o.status)}>{t.statuses[o.status]}</Badge>
                  <span className="tabular w-28 shrink-0 text-right text-sm font-semibold">{fmt(BigInt(o.total_minor), o.currency_code)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title={t.compare.title} description={t.compare.description}>
        {comparisons.length === 0 ? (
          <p className="text-sm text-muted">{t.compare.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t.compare.title}>
            {comparisons.map((c) => (
              <li key={c.key} className="rounded-xl border border-line p-4">
                <p className="break-words font-semibold">{c.itemName}{c.unit ? ` · ${c.unit}` : ""}</p>
                <ol className="mt-2 flex flex-col">
                  {c.offers.map((o, i) => (
                    <li key={o.supplierId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-2 text-sm first:border-t-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <Link href={`/contactos/${o.supplierId}`} className="truncate hover:text-brand">{o.supplierName}</Link>
                        {i === 0 || o.aboveCheapest.amountMinor === 0n ? <Badge tone="brand">{t.compare.cheapest}</Badge> : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-subtle">{day(o.observedOn)}</span>
                        <span className="tabular font-semibold">{fmt(o.price.amountMinor, c.currency)}</span>
                        {o.aboveCheapest.amountMinor > 0n ? (
                          <span className="tabular text-danger">{format(t.compare.above, { amount: fmt(o.aboveCheapest.amountMinor, c.currency) })}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
