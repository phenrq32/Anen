import { NextResponse, type NextRequest } from "next/server";
import { decimalToString, reportLines } from "@anen/financial-engine";
import { csvBody } from "@/lib/csv";
import { getI18n } from "@/lib/i18n";
import { REPORT_DIMENSIONS, loadReport, reportName } from "@/lib/reports";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const { m } = await getI18n();
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const dimension = REPORT_DIMENSIONS.find((d) => d === params.dimensao);
  if (!dimension) return new NextResponse(null, { status: 400 });
  const data = await loadReport(session, m, params);
  if (!data) return new NextResponse(null, { status: 403 });

  const t = m.reports;
  const amount = (v: bigint) => decimalToString({ coefficient: v, scale: data.minorUnit });
  const header = [t.columns.name, `${t.columns.income} (${t.kpi.invoiced})`, `${t.columns.income} (${t.kpi.settled})`, `${t.columns.expense} (${t.kpi.invoiced})`, `${t.columns.expense} (${t.kpi.settled})`, t.columns.result, t.kpi.receivable, t.kpi.payable, t.columns.count, t.currency];
  const lines = reportLines(data.rows, dimension, data.currency).map((l) => [
    reportName(m, data, dimension, l.key),
    amount(l.incomeTotal),
    amount(l.incomeSettled),
    amount(l.expenseTotal),
    amount(l.expenseSettled),
    amount(l.resultTotal),
    amount(l.receivable),
    amount(l.payable),
    String(l.count),
    data.currency,
  ]);
  return new NextResponse(csvBody(header, lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="anen-relatorio-${dimension}-${data.period.from}-${data.period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
