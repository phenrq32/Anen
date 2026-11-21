import type { Metadata } from "next";
import Link from "next/link";
import { isBelowMinimum, stockValue } from "@anen/financial-engine";
import { formatMoney } from "@anen/i18n";
import type { ReorderSuggestion, StockItem } from "@anen/types";
import { Alert, Badge, PageHeader, Section, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { sumByCurrency } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ReorderButton, StockItemForm } from "./inventory-forms";
import { formatQuantity } from "./quantity";

export const metadata: Metadata = { title: "Inventário" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const t = m.inventory;
  if (!scope.canRead) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const showArchived = params.arquivados === "1";

  let itemsQuery = session.supabase.from("stock_items").select("*").eq(scope.column, scope.value).order("name").limit(1000);
  itemsQuery = showArchived ? itemsQuery.not("archived_at", "is", null) : itemsQuery.is("archived_at", null);
  const [itemsRes, suggestionsRes, suppliersRes, currenciesRes] = await Promise.all([
    itemsQuery,
    session.supabase.rpc("stock_reorder_suggestions", { p_org: scope.orgId }),
    session.supabase.from("contacts").select("id, name").eq(scope.column, scope.value).in("kind", ["supplier", "both"]).is("archived_at", null).order("name"),
    session.supabase.from("currencies").select("code, minor_unit, is_enabled").order("code"),
  ]);
  if (itemsRes.error || suggestionsRes.error) throw new Error("Falha ao carregar o inventário");
  const items: StockItem[] = itemsRes.data ?? [];
  const suggestions: ReorderSuggestion[] = suggestionsRes.data ?? [];
  const currencies = currenciesRes.data ?? [];
  const minorUnits = new Map(currencies.map((c) => [c.code, c.minor_unit]));
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);
  const qty = (v: string | number) => formatQuantity(v, locale);

  const values = sumByCurrency(items.map((i) => ({ currency: i.currency_code, amount: stockValue(String(i.quantity_on_hand), BigInt(i.average_cost_minor), i.currency_code).amountMinor })));
  const below = items.filter((i) => isBelowMinimum(String(i.quantity_on_hand), String(i.min_quantity))).length;
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {!scope.canWrite ? <Alert tone="info">{t.readOnly}</Alert> : null}

      {!showArchived ? (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="text-sm text-muted">{t.itemsCount}</span>
            <span className="tabular text-xl font-semibold">{items.length}</span>
          </div>
          <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="text-sm text-muted">{t.totalValue}</span>
            {values.size === 0 ? (
              <span className="tabular text-xl font-semibold text-subtle">—</span>
            ) : (
              [...values].map(([c, v]) => (
                <span key={c} className="tabular text-xl font-semibold">{fmt(v, c)}</span>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
            <span className="text-sm text-muted">{t.belowCount}</span>
            <span className={cx("tabular text-xl font-semibold", below > 0 ? "text-danger" : "")}>{below}</span>
          </div>
        </div>
      ) : null}

      {!showArchived ? (
        <Section title={t.reorder.title} description={t.reorder.description}>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted">{t.reorder.none}</p>
          ) : (
            <div className="flex flex-col gap-5">
              <ul className="-my-2 flex flex-col" aria-label={t.reorder.title}>
                {suggestions.map((s) => (
                  <li key={s.item_id} className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/inventario/${s.item_id}`} className="truncate font-medium hover:text-brand">{s.item_name}</Link>
                      <span className={cx("text-sm", s.supplier_name ? "text-subtle" : "text-danger")}>{s.supplier_name ?? t.reorder.noSupplier}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4 sm:text-right">
                      <div className="flex flex-col">
                        <dt className="text-subtle">{t.reorder.inStock}</dt>
                        <dd className="tabular">{qty(s.quantity_on_hand)} {s.unit}</dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-subtle">{t.reorder.open}</dt>
                        <dd className="tabular">{qty(s.open_quantity)} {s.unit}</dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-subtle">{t.reorder.suggested}</dt>
                        <dd className="tabular font-semibold">{qty(s.suggested_quantity)} {s.unit}</dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-subtle">{t.reorder.lastPrice}</dt>
                        <dd className="tabular">{s.last_unit_price_minor !== null ? fmt(BigInt(s.last_unit_price_minor), s.currency_code) : t.reorder.noLastPrice}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              {scope.canWrite ? <ReorderButton m={m} /> : null}
            </div>
          )}
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/inventario" className={chip(!showArchived)}>{t.active}</Link>
        <Link href="/inventario?arquivados=1" className={chip(showArchived)}>{t.archived}</Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">{showArchived ? t.emptyArchived : t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-subtle">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium sm:px-6">{t.columns.item}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t.columns.quantity}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t.columns.averageCost}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t.columns.value}</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">{t.columns.minimum}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const low = isBelowMinimum(String(i.quantity_on_hand), String(i.min_quantity));
                  return (
                    <tr key={i.id} className="border-b border-line last:border-0 hover:bg-graphite/50">
                      <td className="px-5 py-3 sm:px-6">
                        <Link href={`/inventario/${i.id}`} className="flex flex-wrap items-center gap-2 font-medium hover:text-brand">
                          {i.name}
                          {low ? <Badge tone="danger">{t.belowMinimum}</Badge> : null}
                        </Link>
                        {i.sku ? <span className="text-xs text-subtle">{i.sku}</span> : null}
                      </td>
                      <td className="tabular px-3 py-3 text-right">{qty(i.quantity_on_hand)} {i.unit}</td>
                      <td className="tabular px-3 py-3 text-right">{fmt(BigInt(i.average_cost_minor), i.currency_code)}</td>
                      <td className="tabular px-3 py-3 text-right font-semibold">
                        {fmt(stockValue(String(i.quantity_on_hand), BigInt(i.average_cost_minor), i.currency_code).amountMinor, i.currency_code)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-muted sm:px-6">{qty(i.min_quantity)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {scope.canWrite && !showArchived ? (
        <Section title={t.new}>
          <StockItemForm
            m={m}
            suppliers={suppliersRes.data ?? []}
            currencies={currencies.filter((c) => c.is_enabled).map((c) => c.code)}
            defaultCurrency={scope.defaultCurrency}
          />
        </Section>
      ) : null}
    </>
  );
}
