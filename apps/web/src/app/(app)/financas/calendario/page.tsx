import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { balanceForecast } from "@anen/financial-engine";
import { monthParam } from "@anen/validation";
import { Badge, Section, buttonClass, cx } from "@/components/ui";
import { loadCommitments, type Commitment } from "@/lib/commitments";
import { financeScope, loadFinanceBasics, materializeDue, monthBounds, shiftMonth, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Calendário" };

/** Dia da semana com segunda = 0. */
function weekdayMonday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const t = m.finance.calendar;
  const params = await searchParams;
  const today = todayIn(scope.timezone);
  const month = params.mes && monthParam.safeParse(params.mes).success ? params.mes : today.slice(0, 7);
  const { from, to } = monthBounds(month);
  await materializeDue(session.supabase, scope);

  const showForecast = to >= today;
  const [basics, items, forecastItems] = await Promise.all([
    loadFinanceBasics(session.supabase, scope),
    loadCommitments(session.supabase, scope, { from, until: to, today }),
    // Para a previsão: tudo o que está em aberto até ao fim do mês (incluindo em atraso) e os recorrentes até lá.
    showForecast ? loadCommitments(session.supabase, scope, { from: today, until: to, today, includeOverdue: true }) : Promise.resolve([] as Commitment[]),
  ]);
  const money = (v: bigint, c: string) => formatMoney(v, c, basics.minorUnits.get(c) ?? 2, locale);
  const dateLabel = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short" });

  // Grelha: semanas de segunda a domingo
  const days: string[] = [];
  for (let d = 1; d <= Number(to.slice(8, 10)); d++) days.push(`${month}-${String(d).padStart(2, "0")}`);
  const lead = weekdayMonday(from);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const byDay = new Map<string, Commitment[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);

  // Saldo previsto por moeda: saldo atual (só o liquidado) + previstos
  const currentByCurrency = new Map<string, bigint>();
  for (const a of basics.accounts) {
    if (a.archived_at) continue;
    currentByCurrency.set(a.currency_code, (currentByCurrency.get(a.currency_code) ?? 0n) + (basics.balances.get(a.id) ?? 0n));
  }
  const forecasts = showForecast
    ? [...new Set([...currentByCurrency.keys(), ...forecastItems.map((i) => i.currency)])].sort().map((currency) => ({
        currency,
        current: currentByCurrency.get(currency) ?? 0n,
        result: balanceForecast(
          currentByCurrency.get(currency) ?? 0n,
          today > from ? today : from,
          to,
          forecastItems.filter((i) => i.currency === currency).map((i) => ({ date: i.date, signedMinor: i.kind === "income" ? i.amountMinor : -i.amountMinor })),
        ),
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
      <nav className="flex flex-wrap items-center gap-2" aria-label={t.month}>
        <Link href={`/financas/calendario?mes=${shiftMonth(month, -1)}`} className={buttonClass("secondary", "h-10 px-3")}>
          {t.previous}
        </Link>
        <h2 className="min-w-40 text-center text-base font-semibold first-letter:uppercase">{formatDate(from, locale, "UTC", { month: "long", year: "numeric" })}</h2>
        <Link href={`/financas/calendario?mes=${shiftMonth(month, 1)}`} className={buttonClass("secondary", "h-10 px-3")}>
          {t.next}
        </Link>
      </nav>

      {showForecast ? (
        <Section title={t.forecastTitle} description={t.forecastHint}>
          <ul className="grid gap-4 sm:grid-cols-2">
            {forecasts.map((f) => (
              <li key={f.currency} className="flex flex-col gap-1 rounded-xl border border-line px-4 py-3" aria-label={`${t.forecastTitle} ${f.currency}`}>
                <p className="flex justify-between text-sm">
                  <span className="text-subtle">{t.forecastNow}</span>
                  <span className="tabular">{money(f.current, f.currency)}</span>
                </p>
                <p className="flex justify-between text-sm font-semibold">
                  <span>{t.forecastEnd}</span>
                  <span className={cx("tabular", f.result.endMinor < 0n ? "text-danger" : undefined)}>{money(f.result.endMinor, f.currency)}</span>
                </p>
                {f.result.lowest.balanceMinor < f.result.endMinor ? (
                  <p className={cx("tabular text-xs", f.result.lowest.balanceMinor < 0n ? "text-danger" : "text-subtle")}>
                    {format(t.forecastLowest, { value: money(f.result.lowest.balanceMinor, f.currency), date: dateLabel(f.result.lowest.date) })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <p className="text-xs text-subtle">{t.forecastPast}</p>
      )}

      {/* Grelha (a partir do tablet); no telemóvel, a lista abaixo */}
      <div className="hidden overflow-hidden rounded-xl border border-line md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs text-subtle">
          {t.weekdays.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => (
            <div key={d ?? `empty-${i}`} className={cx("min-h-24 border-b border-r border-line p-1.5 text-xs", d === today ? "bg-brand/5" : undefined)}>
              {d ? (
                <>
                  <p className={cx("mb-1 font-medium", d === today ? "text-brand" : "text-subtle")}>{Number(d.slice(8, 10))}</p>
                  <ul className="flex flex-col gap-1">
                    {(byDay.get(d) ?? []).slice(0, 3).map((it) => (
                      <li key={it.key} className="truncate" title={`${it.description} · ${money(it.amountMinor, it.currency)}`}>
                        <span className={cx("mr-1 inline-block size-1.5 rounded-full align-middle", it.kind === "income" ? "bg-chart-income" : "bg-chart-expense")} aria-hidden />
                        <span className="tabular">{money(it.amountMinor, it.currency)}</span> {it.description}
                      </li>
                    ))}
                    {(byDay.get(d) ?? []).length > 3 ? <li className="text-subtle">+{(byDay.get(d) ?? []).length - 3}</li> : null}
                  </ul>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <Section title={t.list}>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((it) => (
              <li key={it.key} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
                <span className="w-16 shrink-0 text-xs text-subtle">{dateLabel(it.date)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.description}</p>
                  <p className="text-xs text-subtle">
                    {it.kind === "income" ? t.income : t.expense} · {t.sources[it.source]}
                  </p>
                </div>
                {it.overdue ? <Badge tone="danger">{m.finance.tx.overdueBadge}</Badge> : null}
                <span className="tabular text-sm font-semibold">
                  {it.kind === "income" ? "+" : "−"}
                  {money(it.amountMinor, it.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
