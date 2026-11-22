import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isBelowMinimum, stockValue } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { StockItem, StockLot, StockMovement } from "@anen/types";
import { Alert, Badge, Section, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ArchiveStockItemButton, DeleteStockItemButton, StockItemForm, StockMovementForm } from "../inventory-forms";
import { formatQuantity } from "../quantity";

export const metadata: Metadata = { title: "Artigo de stock" };

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const t = m.inventory;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!scope.canRead) return <Alert tone="info">{t.noPermission}</Alert>;

  const { data } = await session.supabase.from("stock_items").select("*").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  const item: StockItem | null = data;
  if (!item) notFound();

  const [movementsRes, suppliersRes, currencyRes, lotsRes] = await Promise.all([
    session.supabase.from("stock_movements").select("*").eq("item_id", id).order("created_at", { ascending: false }).limit(500),
    session.supabase.from("contacts").select("id, name").eq(scope.column, scope.value).in("kind", ["supplier", "both"]).is("archived_at", null).order("name"),
    session.supabase.from("currencies").select("minor_unit").eq("code", item.currency_code).maybeSingle(),
    session.supabase
      .from("stock_lots")
      .select("*")
      .eq("item_id", id)
      .order("expires_on", { ascending: true, nullsFirst: false })
      .order("received_on")
      .order("created_at")
      .limit(300),
  ]);
  const movements: StockMovement[] = movementsRes.data ?? [];
  const allLots: StockLot[] = lotsRes.data ?? [];
  const openLots = allLots.filter((l) => Number(l.quantity_remaining) > 0);
  const finishedLots = allLots.filter((l) => Number(l.quantity_remaining) <= 0).slice(-50).reverse();
  const today = todayIn(scope.timezone);
  const daysTo = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const lotName = (l: StockLot) => l.code ?? (l.origin === "opening" ? t.lots.opening : l.origin === "count" ? t.lots.countAdjust : t.lots.noCode);
  const lotChoices = openLots.map((l) => ({
    id: l.id,
    label: format(t.movement.lotOption, {
      code: lotName(l),
      quantity: formatQuantity(l.quantity_remaining, locale),
      unit: item.unit,
      expiry: l.expires_on ? format(t.movement.lotExpiry, { date: formatDate(l.expires_on, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }) }) : "",
    }),
  }));
  const suppliers = suppliersRes.data ?? [];
  const minorUnit = currencyRes.data?.minor_unit ?? 2;
  const fmt = (v: bigint) => formatMoney(v, item.currency_code, minorUnit, locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const qty = (v: string | number, signed = false) => formatQuantity(v, locale, signed);
  const low = isBelowMinimum(String(item.quantity_on_hand), String(item.min_quantity));
  const supplier = suppliers.find((s) => s.id === item.preferred_supplier_id);

  const kpis = [
    { label: t.kpi.quantity, value: `${qty(item.quantity_on_hand)} ${item.unit}`, danger: low },
    { label: t.kpi.averageCost, value: `${fmt(BigInt(item.average_cost_minor))} / ${item.unit}`, danger: false },
    { label: t.kpi.value, value: fmt(stockValue(String(item.quantity_on_hand), BigInt(item.average_cost_minor), item.currency_code).amountMinor), danger: false },
  ];

  function LotTable({ lots }: { lots: StockLot[] }) {
    return (
      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{t.lots.code}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t.lots.expiresOn}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{t.lots.received}</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">{t.lots.remaining}</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const left = l.expires_on ? daysTo(l.expires_on) : null;
              const open = Number(l.quantity_remaining) > 0;
              return (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 sm:px-6">{lotName(l)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      {l.expires_on ? <time dateTime={l.expires_on}>{day(l.expires_on)}</time> : <span className="text-subtle">{t.lots.noExpiry}</span>}
                      {open && left !== null && left < 0 ? <Badge tone="danger">{t.lots.expired}</Badge> : null}
                      {open && left === 0 ? <Badge tone="danger">{t.lots.expiresToday}</Badge> : null}
                      {open && left !== null && left > 0 && left <= 7 ? <Badge tone="brand">{format(t.lots.expiresSoon, { days: left })}</Badge> : null}
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><time dateTime={l.received_on}>{day(l.received_on)}</time></td>
                  <td className="tabular px-5 py-2.5 text-right sm:px-6">
                    {qty(l.quantity_remaining)} / {qty(l.quantity_received)} {item!.unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link href="/inventario" className="text-sm text-muted hover:text-paper">← {t.back}</Link>
          <h1 className="flex flex-wrap items-center gap-3 break-words text-2xl font-bold sm:text-[28px]">
            {item.name}
            {low ? <Badge tone="danger">{t.belowMinimum}</Badge> : null}
            {item.archived_at ? <Badge>{t.archivedBadge}</Badge> : null}
          </h1>
          <p className="break-words text-sm text-subtle">
            {[item.sku, item.unit, item.currency_code, supplier ? `${t.fields.preferredSupplier}: ${supplier.name}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {scope.canWrite ? (
          <div className="flex flex-wrap gap-2">
            <ArchiveStockItemButton m={m} id={item.id} archived={Boolean(item.archived_at)} />
            {movements.length === 0 ? <DeleteStockItemButton m={m} id={item.id} /> : null}
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="text-sm text-muted">{k.label}</span>
            <span className={cx("tabular text-xl font-semibold", k.danger ? "text-danger" : "")}>{k.value}</span>
          </div>
        ))}
      </div>

      {scope.canWrite && !item.archived_at ? (
        <Section title={t.movement.title}>
          <StockMovementForm m={m} itemId={item.id} unit={item.unit} today={today} lots={lotChoices} />
        </Section>
      ) : null}

      <Section title={t.lots.title} description={t.lots.description}>
        {openLots.length === 0 ? (
          <p className="text-sm text-muted">{t.lots.empty}</p>
        ) : (
          <LotTable lots={openLots} />
        )}
        {finishedLots.length > 0 ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer select-none text-muted hover:text-paper">{t.lots.showFinished}</summary>
            <div className="mt-3">
              <LotTable lots={finishedLots} />
            </div>
          </details>
        ) : null}
      </Section>

      <Section title={t.history.title} description={t.history.immutable}>
        {movements.length === 0 ? (
          <p className="text-sm text-muted">{t.history.empty}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{t.history.date}</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">{t.history.kind}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.history.change}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.history.balance}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.history.cost}</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">{t.history.average}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((mv) => (
                  <tr key={mv.id} className="border-b border-line align-top last:border-0">
                    <td className="px-5 py-2.5 sm:px-6">
                      <time dateTime={mv.occurred_on}>{day(mv.occurred_on)}</time>
                      {mv.notes ? <p className="max-w-64 break-words text-xs text-subtle">{mv.notes}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        {t.movement.kinds[mv.kind]}
                        {mv.purchase_order_id ? (
                          <Link href={`/compras/${mv.purchase_order_id}`} className="text-xs text-muted hover:text-brand">{t.history.order}</Link>
                        ) : null}
                        {mv.lot_code || mv.expires_on ? (
                          <span className="text-xs text-subtle">
                            {[mv.lot_code ? `${t.lots.code} ${mv.lot_code}` : null, mv.expires_on ? `${t.lots.expiresOn} ${day(mv.expires_on)}` : null].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={cx("tabular px-3 py-2.5 text-right", Number(mv.quantity_change) < 0 ? "text-danger" : "")}>{qty(mv.quantity_change, true)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{qty(mv.balance_after)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{mv.unit_cost_minor !== null ? fmt(BigInt(mv.unit_cost_minor)) : "—"}</td>
                    <td className="tabular px-5 py-2.5 text-right sm:px-6">{fmt(BigInt(mv.average_cost_after))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {scope.canWrite ? (
        <Section title={t.edit}>
          <StockItemForm m={m} initial={item} suppliers={suppliers} currencies={[item.currency_code]} defaultCurrency={item.currency_code} />
        </Section>
      ) : null}
    </>
  );
}
