"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { formatMoney } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { cx } from "@/components/ui";

/** Valores chegam como string (unidades mínimas) para não perder precisão na serialização. */
export interface MonthlyPoint {
  month: string; // YYYY-MM
  label: string; // "nov."
  fullLabel: string; // "novembro de 2026"
  income: string;
  expense: string;
}

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

/** Máximo "redondo" para o eixo e passo das linhas de grelha. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((f) => f * magnitude >= raw) ?? 10) * magnitude;
  return { top: step * ticks, step };
}

export function MonthlyChart({
  data,
  currency,
  minorUnit,
  locale,
  labels,
}: {
  data: MonthlyPoint[];
  currency: string;
  minorUnit: number;
  locale: Locale;
  labels: { title: string; subtitle: string; income: string; expense: string; result: string; month: string; showTable: string; showChart: string };
}) {
  const mounted = useMounted();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();
  const divisor = 10 ** minorUnit;

  const { top, step } = useMemo(() => {
    const max = Math.max(0, ...data.flatMap((d) => [Number(d.income), Number(d.expense)])) / divisor;
    return niceScale(max);
  }, [data, divisor]);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const money = (minor: string | bigint) => formatMoney(BigInt(minor), currency, minorUnit, locale);
  const pct = (minor: string) => `${Math.min(100, (Number(minor) / divisor / top) * 100)}%`;
  const activePoint = active === null ? null : data[active];

  return (
    <figure aria-labelledby={titleId} className="flex flex-col gap-4">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold">{labels.title}</h2>
          <p className="text-sm text-muted">{labels.subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex items-center gap-4 text-sm text-muted" aria-label="Legenda">
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-[3px] bg-chart-income" aria-hidden /> {labels.income}
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-[3px] bg-chart-expense" aria-hidden /> {labels.expense}
            </li>
          </ul>
          <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-subtle underline-offset-4 hover:text-paper hover:underline">
            {table ? labels.showChart : labels.showTable}
          </button>
        </div>
      </figcaption>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="py-2 font-medium">{labels.month}</th>
                <th className="py-2 text-right font-medium">{labels.income}</th>
                <th className="py-2 text-right font-medium">{labels.expense}</th>
                <th className="py-2 text-right font-medium">{labels.result}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-b border-line/60 last:border-0">
                  <td className="py-2 capitalize">{d.fullLabel}</td>
                  <td className="tabular py-2 text-right">{money(d.income)}</td>
                  <td className="tabular py-2 text-right">{money(d.expense)}</td>
                  <td className="tabular py-2 text-right">{money(BigInt(d.income) - BigInt(d.expense))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative pl-12">
          {/* Grelha e eixo Y */}
          <div className="absolute inset-y-0 left-0 right-0 bottom-7" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute left-0 right-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }}>
                <span className="tabular w-10 shrink-0 pr-2 text-right text-[11px] leading-none text-subtle">{compact.format(t)}</span>
                <span className="h-px flex-1 bg-grid" />
              </div>
            ))}
          </div>
          <div className="relative flex h-60 items-stretch" onMouseLeave={() => setActive(null)}>
            {data.map((d, i) => (
              <div
                key={d.month}
                tabIndex={0}
                role="img"
                aria-label={`${d.fullLabel}: ${labels.income} ${money(d.income)}, ${labels.expense} ${money(d.expense)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cx("group relative flex flex-1 flex-col justify-end outline-none", active === i && "bg-paper/[0.03]")}
              >
                <div className="flex h-[calc(100%-28px)] items-end justify-center gap-[2px]">
                  {(["income", "expense"] as const).map((key, k) => (
                    <span
                      key={key}
                      className={cx(
                        "w-full max-w-[10px] rounded-t-[4px] transition-[height,opacity] duration-700 ease-out",
                        key === "income" ? "bg-chart-income" : "bg-chart-expense",
                        active !== null && active !== i && "opacity-40",
                      )}
                      style={{ height: mounted ? pct(d[key]) : "0%", transitionDelay: `${i * 35 + k * 20}ms` }}
                    />
                  ))}
                </div>
                <span className={cx("h-7 pt-2 text-center text-[11px] capitalize text-subtle", i % 2 === 1 && "max-sm:invisible")}>{d.label}</span>
              </div>
            ))}
          </div>
          {activePoint && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 w-52 -translate-x-1/2 rounded-lg border border-line bg-ink/95 p-3 text-sm shadow-lg backdrop-blur"
              style={{ left: `calc(3rem + (100% - 3rem) * ${(active + 0.5) / data.length})` }}
            >
              <p className="mb-2 font-medium capitalize">{activePoint.fullLabel}</p>
              <dl className="flex flex-col gap-1">
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted"><span className="size-2 rounded-[2px] bg-chart-income" />{labels.income}</dt>
                  <dd className="tabular">{money(activePoint.income)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted"><span className="size-2 rounded-[2px] bg-chart-expense" />{labels.expense}</dt>
                  <dd className="tabular">{money(activePoint.expense)}</dd>
                </div>
                <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1">
                  <dt className="text-muted">{labels.result}</dt>
                  <dd className="tabular font-medium">{money(BigInt(activePoint.income) - BigInt(activePoint.expense))}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}

export interface CategorySlice {
  id: string;
  label: string;
  amount: string;
  count: number;
}

export function CategoryBars({
  data,
  currency,
  minorUnit,
  locale,
  title,
  subtitle,
  empty,
}: {
  data: CategorySlice[];
  currency: string;
  minorUnit: number;
  locale: Locale;
  title: string;
  subtitle: string;
  empty: string;
}) {
  const mounted = useMounted();
  const total = data.reduce((acc, d) => acc + BigInt(d.amount), 0n);
  const max = data.reduce((acc, d) => (BigInt(d.amount) > acc ? BigInt(d.amount) : acc), 0n);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  return (
    <figure className="flex flex-col gap-4">
      <figcaption>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </figcaption>
      {data.length === 0 ? (
        <p className="py-6 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((d, i) => {
            const share = total > 0n ? Number((BigInt(d.amount) * 10000n) / total) / 10000 : 0;
            const width = max > 0n ? Number((BigInt(d.amount) * 10000n) / max) / 100 : 0;
            return (
              <li key={d.id} className="group flex flex-col gap-1.5" title={`${d.count} · ${percent.format(share)}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{d.label}</span>
                  <span className="tabular shrink-0 text-muted">
                    {formatMoney(BigInt(d.amount), currency, minorUnit, locale)}
                    <span className="ml-2 text-xs text-subtle">{percent.format(share)}</span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-graphite">
                  <div
                    className="h-full rounded-r-[4px] bg-chart-expense transition-[width] duration-700 ease-out group-hover:brightness-110"
                    style={{ width: mounted ? `${width}%` : "0%", transitionDelay: `${i * 60}ms` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

/** Número que conta até ao valor final (só visual); o valor final é formatado com exatidão. */
export function AnimatedMoney({
  amountMinor,
  currency,
  minorUnit,
  locale,
  className,
}: {
  amountMinor: string;
  currency: string;
  minorUnit: number;
  locale: Locale;
  className?: string;
}) {
  const exact = formatMoney(BigInt(amountMinor), currency, minorUnit, locale);
  const [display, setDisplay] = useState<string>(() => formatMoney(0n, currency, minorUnit, locale));
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = BigInt(amountMinor);
    if (reduce || target === 0n) {
      setDisplay(exact);
      return;
    }
    const start = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      if (t >= 1) {
        setDisplay(exact);
        return;
      }
      const partial = (target * BigInt(Math.round(eased * 1000))) / 1000n;
      setDisplay(formatMoney(partial, currency, minorUnit, locale));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [amountMinor, currency, minorUnit, locale, exact]);
  return (
    <span className={cx("tabular", className)}>
      <span className="sr-only">{exact}</span>
      <span aria-hidden>{display}</span>
    </span>
  );
}
