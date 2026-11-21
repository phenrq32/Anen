import type { Metadata } from "next";
import Link from "next/link";
import { decimalToString, readMarketSeries, type MarketPoint } from "@anen/financial-engine";
import { format, formatDate, formatMoney, type Messages } from "@anen/i18n";
import type { Locale, MarketCategory, MarketSeries } from "@anen/types";
import { parseAmountInput } from "@anen/validation";
import { InlineAction } from "@/components/forms";
import { Alert, Badge, PageHeader, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { getI18n } from "@/lib/i18n";
import { numericToString } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { markAlertsReadAction, runMarketAgentAction } from "./actions";
import { WatchControl } from "./watch-control";

export const metadata: Metadata = { title: "Mercado" };

const COUNTRIES = ["PT", "BR"] as const;
const CATEGORIES: MarketCategory[] = ["general", "food", "services", "energy", "fuel", "construction"];

/** Percentagem publicada pela fonte (texto decimal exato) → "+0,66 %". */
function pct(value: string | null, locale: Locale): string {
  if (value === null) return "—";
  const n = new Intl.NumberFormat(locale, { signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n.format(value as Intl.StringNumericLiteral)} %`;
}

function monthLabel(period: string, locale: Locale): string {
  return formatDate(period, locale, "UTC", { month: "long", year: "numeric" });
}

const toPoint = (o: { period: string; value: number | null; change_month: number | null; change_year: number | null }): MarketPoint => ({
  period: o.period,
  value: o.value === null ? null : numericToString(o.value, 4),
  changeMonth: o.change_month === null ? null : numericToString(o.change_month, 3),
  changeYear: o.change_year === null ? null : numericToString(o.change_year, 3),
});

export default async function MarketPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const params = await searchParams;
  const country = COUNTRIES.find((c) => c === params.pais) ?? (scope.defaultCurrency === "BRL" ? "BR" : "PT");
  const t = m.market;

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 14);
  const [{ data: sources }, { data: allSeries }, { data: admin }, watchesRes, alertsRes] = await Promise.all([
    session.supabase.from("market_sources").select("*").order("key"),
    session.supabase.from("market_series").select("*").eq("is_active", true).order("position"),
    session.supabase.from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    scope.canRead ? session.supabase.from("market_watches").select("*").eq(scope.column, scope.value) : Promise.resolve({ data: [] }),
    scope.canRead
      ? session.supabase.from("market_alerts").select("*").eq(scope.column, scope.value).is("read_at", null).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const countrySources = (sources ?? []).filter((s) => s.country === country);
  const sourceIds = new Set(countrySources.map((s) => s.id));
  const series = (allSeries ?? []).filter((s) => sourceIds.has(s.source_id));
  const { data: observations } = series.length
    ? await session.supabase
        .from("market_observations")
        .select("series_id, period, value, change_month, change_year, collected_at")
        .in("series_id", series.map((s) => s.id))
        .gte("period", since.toISOString().slice(0, 10))
        .order("period")
    : { data: [] };
  const lastRun = admin
    ? (await session.supabase.from("job_runs").select("*").eq("job", "market_agent").order("started_at", { ascending: false }).limit(1).maybeSingle()).data
    : null;

  const byId = new Map((allSeries ?? []).map((s) => [s.id, s]));
  const points = new Map<string, MarketPoint[]>();
  for (const o of observations ?? []) {
    const list = points.get(o.series_id) ?? [];
    list.push(toPoint(o));
    points.set(o.series_id, list);
  }
  const watches = new Map((watchesRes.data ?? []).map((w) => [w.series_id, w]));
  const alerts = alertsRes.data ?? [];
  const hasData = series.some((s) => points.has(s.id));

  return (
    <>
      <PageHeader title={t.title} description={t.subtitle} />

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="agent-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 id="agent-title" className="text-base font-semibold">{t.agent.title}</h2>
            <p className="text-sm text-muted">{t.agent.description}</p>
          </div>
          {admin ? <InlineAction action={runMarketAgentAction} fields={{}} label={t.agent.runNow} pendingLabel={m.common.saving} variant="secondary" /> : null}
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {(sources ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{s.publisher}</span>
              <span className="text-subtle">{s.country}</span>
              <span className="text-muted">
                {s.last_success_at ? format(t.agent.lastSuccess, { date: formatDate(s.last_success_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" }) }) : t.agent.never}
              </span>
              {s.last_error ? <span className="text-xs text-danger">{format(t.agent.error, { error: s.last_error })}</span> : null}
            </li>
          ))}
        </ul>
        {lastRun ? (
          <p className="text-xs text-subtle">
            {format(t.agent.lastRun, { date: formatDate(lastRun.started_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" }), status: t.agent.statuses[lastRun.status] })}
            {` · ${format(t.agent.ran, { observations: lastRun.processed, failed: lastRun.failed, alerts: lastRun.details.alerts ?? 0 })}`}
          </p>
        ) : null}
      </section>

      {scope.canRead && alerts.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand/5 p-5 sm:p-6" aria-labelledby="alerts-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="alerts-title" className="text-base font-semibold">{t.alerts.title}</h2>
            <InlineAction action={markAlertsReadAction} fields={{}} label={t.alerts.markRead} pendingLabel={m.common.saving} />
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {alerts.map((a) => (
              <li key={a.id}>
                {format(t.alerts.item, {
                  series: byId.get(a.series_id)?.name ?? "—",
                  change: pct(numericToString(a.change_month, 3), locale),
                  period: monthLabel(a.period, locale),
                  threshold: `${numericToString(a.threshold_percent, 3).replace(".", ",")} p.p.`,
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label={t.title} className="flex gap-2">
        {COUNTRIES.map((c) => (
          <Link
            key={c}
            href={`/mercado?pais=${c}`}
            aria-current={c === country ? "page" : undefined}
            className={cx(
              "h-9 rounded-full border px-4 text-sm leading-9",
              c === country ? "border-brand bg-brand text-ink font-semibold" : "border-line text-muted hover:border-brand hover:text-paper",
            )}
          >
            {t.countries[c]}
          </Link>
        ))}
      </nav>

      {!hasData ? (
        <Alert tone="info">{t.empty}</Alert>
      ) : (
        CATEGORIES.map((category) => {
          const rows = series.filter((s) => s.category === category && points.has(s.id));
          if (!rows.length) return null;
          return (
            <section key={category} className="flex flex-col gap-3" aria-labelledby={`cat-${category}`}>
              <h2 id={`cat-${category}`} className="text-base font-semibold">{t.categories[category]}</h2>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-subtle">
                      <th className="px-4 py-3 font-medium">{t.columns.series}</th>
                      <th className="px-4 py-3 font-medium">{t.columns.period}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.columns.value}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.columns.month}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.columns.three}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.columns.year}</th>
                      {scope.canWrite ? <th className="px-4 py-3 text-right font-medium">{t.columns.watch}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <SeriesRow key={s.id} m={m} locale={locale} series={s} points={points.get(s.id) ?? []} canWrite={scope.canWrite} watch={watches.get(s.id) ?? null} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-4 text-xs text-subtle">
        <h2 className="text-sm font-semibold text-muted">{t.sources}</h2>
        {countrySources.map((s) => (
          <p key={s.id}>
            {format(t.sourceLine, { publisher: s.publisher, name: s.name, license: s.license })}{" "}
            <a href={s.docs_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-paper">{t.open}</a>
          </p>
        ))}
        <p>{t.disclaimer}</p>
      </section>
    </>
  );
}

function SeriesRow({
  m,
  locale,
  series,
  points,
  canWrite,
  watch,
}: {
  m: Messages;
  locale: Locale;
  series: MarketSeries;
  points: MarketPoint[];
  canWrite: boolean;
  watch: { id: string; threshold_percent: number } | null;
}) {
  const reading = readMarketSeries(points);
  if (!reading) return null;
  const { latest } = reading;
  let value = m.market.noValue;
  if (latest.value !== null && series.value_kind === "price" && series.currency_code) {
    const minor = parseAmountInput(numericToString(Number(latest.value), 2), 2);
    value = minor === null ? "—" : `${formatMoney(minor, series.currency_code, 2, locale)}${series.value_unit?.includes("/") ? `/${series.value_unit.split("/")[1]}` : ""}`;
  } else if (latest.value !== null) {
    value = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(latest.value as Intl.StringNumericLiteral);
  }
  const tone = reading.direction === "up" ? "text-danger" : reading.direction === "down" ? "text-success" : "text-muted";
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="px-4 py-3">
        <span className="font-medium">{series.name}</span>
        {series.value_kind === "index" && series.value_unit ? <span className="ml-2 text-xs text-subtle">{series.value_unit}</span> : null}
        {watch ? <span className="ml-2"><Badge tone="brand">{m.market.watch.watching}</Badge></span> : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted">{monthLabel(latest.period, locale)}</td>
      <td className="tabular whitespace-nowrap px-4 py-3 text-right">{value}</td>
      <td className={cx("tabular whitespace-nowrap px-4 py-3 text-right font-medium", tone)}>{pct(latest.changeMonth, locale)}</td>
      <td className="tabular whitespace-nowrap px-4 py-3 text-right">{reading.change3Months ? pct(decimalToString(reading.change3Months), locale) : "—"}</td>
      <td className="tabular whitespace-nowrap px-4 py-3 text-right">{pct(latest.changeYear, locale)}</td>
      {canWrite ? (
        <td className="px-4 py-2">
          <WatchControl
            m={m}
            seriesId={series.id}
            seriesName={series.name}
            watch={watch ? { id: watch.id, threshold: numericToString(watch.threshold_percent, 3).replace(".", ",") } : null}
          />
        </td>
      ) : null}
    </tr>
  );
}
