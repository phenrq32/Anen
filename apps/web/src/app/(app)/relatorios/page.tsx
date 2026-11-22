import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_PRESETS, reportLines, reportTotal } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { Alert, PageHeader, Section, buttonClass, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { getI18n } from "@/lib/i18n";
import { REPORT_DIMENSIONS, loadReport, reportName, reportQuery } from "@/lib/reports";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Relatórios" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.reports;
  const data = await loadReport(session, m, await searchParams);
  if (!data) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const biz = businessScope(session);
  const fmt = (v: bigint) => formatMoney(v, data.currency, data.minorUnit, locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const monthName = (mo: string) => formatDate(`${mo}-01`, locale, "UTC", { month: "short", year: "numeric" });
  const total = reportTotal(data.rows, data.currency);
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");
  const presetHref = (preset: string) => `/relatorios?${new URLSearchParams({ periodo: preset, moeda: data.currency })}`;
  const signed = (v: bigint) => cx("tabular", v < 0n ? "text-danger" : "");

  const kpis = [
    { label: t.kpi.income, main: total.incomeTotal, sub: `${t.kpi.settled}: ${fmt(total.incomeSettled)}` },
    { label: t.kpi.expense, main: total.expenseTotal, sub: `${t.kpi.settled}: ${fmt(total.expenseSettled)}` },
    { label: t.kpi.result, main: total.resultTotal, sub: `${t.kpi.settled}: ${fmt(total.resultSettled)}`, signed: true },
    { label: t.kpi.open, main: total.receivable + total.payable, sub: `${t.kpi.receivable}: ${fmt(total.receivable)} · ${t.kpi.payable}: ${fmt(total.payable)}` },
  ];

  return (
    <>
      <PageHeader title={t.title} description={t.description} />

      <section aria-label={t.period} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {REPORT_PRESETS.filter((p) => p !== "custom").map((p) => (
            <Link key={p} href={presetHref(p)} className={chip(data.preset === p)}>{t.presets[p]}</Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="periodo" value="custom" />
          <input type="hidden" name="moeda" value={data.currency} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t.from}</span>
            <input type="date" name="de" defaultValue={data.period.from} required className="h-10 rounded-md border border-line bg-surface px-3 text-paper focus:border-brand focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t.to}</span>
            <input type="date" name="ate" defaultValue={data.period.to} required className="h-10 rounded-md border border-line bg-surface px-3 text-paper focus:border-brand focus:outline-none" />
          </label>
          <button type="submit" className={buttonClass("secondary", "h-10")}>{t.apply}</button>
        </form>
        <p className="text-sm text-subtle">
          {format(t.periodLabel, { from: day(data.period.from), to: day(data.period.to) })}
          {data.currencies.length > 1 ? (
            <>
              {" · "}
              {t.currency}:{" "}
              {data.currencies.map((c, i) => (
                <span key={c}>
                  {i > 0 ? " · " : ""}
                  <Link href={`/relatorios?${reportQuery(data, { moeda: c })}`} className={c === data.currency ? "font-semibold text-paper" : "hover:text-paper"}>{c}</Link>
                </span>
              ))}
            </>
          ) : null}
        </p>
      </section>

      {total.count === 0 ? (
        <Alert tone="info">{t.empty}</Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
                <span className="text-sm text-muted">{k.label}</span>
                <span className={cx("text-xl font-semibold", k.signed ? signed(k.main) : "tabular")}>{fmt(k.main)}</span>
                <span className="text-xs text-subtle">{k.sub}</span>
              </div>
            ))}
          </div>

          {!biz.canRead ? <Alert tone="info">{t.noBusiness}</Alert> : null}

          <Section title={t.sections.monthly}>
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="border-b border-line text-left text-subtle">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{t.columns.month}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.columns.income}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.columns.expense}</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">{t.columns.result}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((row) => (
                    <tr key={row.month} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 sm:px-6">{monthName(row.month)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{fmt(row.income)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{fmt(row.expense)}</td>
                      <td className={cx("px-5 py-2.5 text-right font-semibold sm:px-6", signed(row.income - row.expense))}>{fmt(row.income - row.expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {REPORT_DIMENSIONS.map((dimension) => {
            const lines = reportLines(data.rows, dimension, data.currency);
            // Sem nenhum valor atribuído (só a linha "Sem …"), a secção não acrescenta nada.
            if (lines.length === 0 || (lines.length === 1 && lines[0]!.key === null && dimension !== "category")) return null;
            return (
              <Section key={dimension} title={t.sections[dimension]}>
                <div className="flex flex-col gap-4">
                  <div className="-mx-5 overflow-x-auto sm:-mx-6">
                    <table className="w-full min-w-[640px] text-sm" aria-label={t.sections[dimension]}>
                      <thead className="border-b border-line text-left text-subtle">
                        <tr>
                          <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{t.columns.name}</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.columns.income}</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.columns.expense}</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.columns.result}</th>
                          <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">{t.columns.open}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.key ?? "none"} className="border-b border-line last:border-0">
                            <td className={cx("px-5 py-2.5 sm:px-6", l.key === null ? "text-muted" : "")}>{reportName(m, data, dimension, l.key)}</td>
                            <td className="tabular px-3 py-2.5 text-right">{l.incomeTotal > 0n ? fmt(l.incomeTotal) : "—"}</td>
                            <td className="tabular px-3 py-2.5 text-right">{l.expenseTotal > 0n ? fmt(l.expenseTotal) : "—"}</td>
                            <td className={cx("px-3 py-2.5 text-right font-semibold", signed(l.resultTotal))}>{fmt(l.resultTotal)}</td>
                            <td className="tabular px-5 py-2.5 text-right sm:px-6">{l.receivable + l.payable > 0n ? fmt(l.receivable + l.payable) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <a href={`/relatorios/exportar?${reportQuery(data, { dimensao: dimension })}`} className={buttonClass("ghost", "-ml-3 self-start")}>
                    {t.exportCsv}
                  </a>
                </div>
              </Section>
            );
          })}
        </>
      )}
    </>
  );
}
