import Link from "next/link";
import { businessPulse } from "@anen/financial-engine";
import { format, formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { cx } from "@/components/ui";
import type { BusinessScope } from "@/lib/business";
import { type FinanceScope } from "@/lib/finance";
import type { FinanceOverview } from "@/lib/finance-overview";
import type { ServerClient } from "@/lib/supabase/server";

const FORECAST_DAYS = 30;

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dual Workspace · Fase 6 (§6.1): "Hoje" de uma empresa. Saldo, lucro, fluxo previsto e operação, com o que
 * já aconteceu claramente separado do que está previsto. Números do motor (businessPulse), dados reais.
 */
export async function BusinessToday({
  m,
  locale,
  supabase,
  fin,
  biz,
  quotes,
  finance,
  alertsCount,
}: {
  m: Messages;
  locale: Locale;
  supabase: ServerClient;
  fin: FinanceScope;
  biz: BusinessScope;
  quotes: FinanceScope;
  finance: FinanceOverview;
  /** Alertas financeiros de severidade média ou alta (centro de inteligência); null se indisponível. */
  alertsCount: number | null;
}) {
  const t = m.dashboard.business;
  const currency = finance.currency;
  const horizon = addDays(finance.today, FORECAST_DAYS);
  const [openRes, quotesRes, projectsRes, marketRes, watchesRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("kind, amount_minor, settled_minor, due_on")
      .eq(fin.column, fin.value)
      .eq("currency_code", currency)
      .in("payment_status", ["pending", "partial"])
      .limit(5000),
    quotes.canRead
      ? supabase.from("quotes").select("total_minor").eq(quotes.column, quotes.value).eq("status", "sent").eq("currency_code", currency).limit(1000)
      : Promise.resolve({ data: null }),
    biz.canRead
      ? supabase.from("projects").select("id", { count: "exact", head: true }).eq(biz.column, biz.value).eq("status", "active")
      : Promise.resolve({ count: null }),
    biz.canRead
      ? supabase.from("market_alerts").select("id", { count: "exact", head: true }).eq(biz.column, biz.value).is("read_at", null)
      : Promise.resolve({ count: null }),
    biz.canRead
      ? supabase.from("market_watches").select("id", { count: "exact", head: true }).eq(biz.column, biz.value)
      : Promise.resolve({ count: null }),
  ]);

  const pulse = businessPulse({
    cashMinor: finance.balance,
    incomeMinor: finance.income,
    expenseMinor: finance.expense,
    open: (openRes.data ?? []).map((o) => ({
      kind: o.kind === "income" ? "income" : "expense",
      remainingMinor: BigInt(o.amount_minor) - BigInt(o.settled_minor),
      dueOn: o.due_on,
    })),
    today: finance.today,
    horizon,
  });
  const fmt = (v: bigint) => formatMoney(v, currency, finance.minorUnit, locale);
  const pct = (bp: bigint) =>
    `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(`${bp < 0n ? "-" : ""}${(bp < 0n ? -bp : bp) / 100n}.${((bp < 0n ? -bp : bp) % 100n).toString().padStart(2, "0")}` as Intl.StringNumericLiteral)} %`;
  const pendingQuotes = quotesRes.data;
  const pendingTotal = (pendingQuotes ?? []).reduce((s, q) => s + BigInt(q.total_minor), 0n);
  const periodLabel = m.dashboard.period[finance.period];
  const horizonLabel = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${horizon}T00:00:00Z`));

  const money = [
    { label: t.cash, value: fmt(pulse.cashMinor), hint: t.cashHint, tone: "" },
    {
      label: pulse.resultMinor < 0n ? t.loss : t.result,
      value: fmt(pulse.resultMinor),
      hint: format(t.resultHint, { income: fmt(pulse.incomeMinor), expense: fmt(pulse.expenseMinor), period: periodLabel.toLowerCase() }),
      tone: pulse.resultMinor < 0n ? "text-danger" : "text-brand",
    },
    {
      label: t.margin,
      value: pulse.marginBasisPoints === null ? "—" : pct(pulse.marginBasisPoints),
      hint: pulse.marginBasisPoints === null ? t.marginNone : t.marginHint,
      tone: pulse.marginBasisPoints !== null && pulse.marginBasisPoints < 0n ? "text-danger" : "",
    },
    { label: t.forecast, value: fmt(pulse.forecastMinor), hint: format(t.forecastHint, { date: horizonLabel }), tone: pulse.forecastMinor < 0n ? "text-danger" : "" },
  ];

  const operation: { label: string; value: string; hint: string; href: string; warn?: boolean }[] = [
    {
      label: t.receivable,
      value: fmt(pulse.receivableMinor),
      hint: pulse.overdueReceivables ? format(t.overdue, { count: pulse.overdueReceivables }) : t.onTime,
      href: "/financas/em-aberto",
      warn: pulse.overdueReceivables > 0,
    },
    {
      label: t.payable,
      value: fmt(pulse.payableMinor),
      hint: pulse.overduePayables ? format(t.overdue, { count: pulse.overduePayables }) : t.onTime,
      href: "/financas/em-aberto",
      warn: pulse.overduePayables > 0,
    },
  ];
  if (pendingQuotes) {
    operation.push({
      label: t.quotesPending,
      value: fmt(pendingTotal),
      hint: pendingQuotes.length ? format(t.quotesPendingHint, { count: pendingQuotes.length }) : t.quotesNone,
      href: "/orcamentos?estado=sent",
    });
  }
  if (projectsRes.count !== null) {
    operation.push({ label: t.projects, value: String(projectsRes.count), hint: t.projectsHint, href: "/projetos" });
  }
  if (alertsCount !== null) {
    operation.push({ label: t.alerts, value: String(alertsCount), hint: alertsCount ? t.alertsHint : t.alertsNone, href: "/inteligencia?periodo=month", warn: alertsCount > 0 });
  }
  if (marketRes.count !== null) {
    operation.push({
      label: t.market,
      value: String(marketRes.count),
      hint: (watchesRes.count ?? 0) > 0 ? t.marketHint : t.marketNone,
      href: "/mercado",
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="biz-money" className="flex flex-col gap-3">
        <div>
          <h2 id="biz-money" className="text-lg font-bold">{t.moneyTitle}</h2>
          <p className="text-sm text-muted">{format(t.moneyHint, { currency })}</p>
          {finance.otherCurrencies.length ? <p className="text-xs text-subtle">{format(t.otherCurrencies, { currencies: finance.otherCurrencies.join(", ") })}</p> : null}
        </div>
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {money.map((c) => (
            <li key={c.label} className="flex flex-col gap-1.5 rounded-2xl border glass spot p-4" aria-label={c.label}>
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{c.label}</span>
              <span className={cx("tabular font-heading text-2xl font-bold", c.tone)}>{c.value}</span>
              <span className="text-xs text-muted">{c.hint}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="biz-operation" className="flex flex-col gap-3">
        <h2 id="biz-operation" className="text-lg font-bold">{t.operationTitle}</h2>
        <ul className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
          {operation.map((c) => (
            <li key={c.label}>
              <Link href={c.href} aria-label={c.label} className="lift flex h-full flex-col gap-1 rounded-2xl border glass spot p-4 hover:border-graphite-soft">
                <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{c.label}</span>
                <span className="tabular font-heading text-xl font-bold">{c.value}</span>
                <span className={cx("text-xs", c.warn ? "text-danger" : "text-muted")}>{c.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
