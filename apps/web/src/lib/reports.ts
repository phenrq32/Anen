import "server-only";
import {
  REPORT_PRESETS,
  reportCurrencies,
  reportPeriod,
  type ReportDimension,
  type ReportPeriod,
  type ReportPreset,
  type ReportRow,
} from "@anen/financial-engine";
import type { Messages } from "@anen/i18n";
import { businessScope } from "@/lib/business";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import type { SessionContext } from "@/lib/session";

export const REPORT_DIMENSIONS = ["category", "contact", "project", "cost_center"] as const;
export type ReportBreakdown = (typeof REPORT_DIMENSIONS)[number];

export interface ReportData {
  preset: ReportPreset;
  period: ReportPeriod;
  currencies: string[];
  currency: string;
  minorUnit: number;
  rows: ReportRow[];
  monthly: { month: string; income: bigint; expense: bigint }[];
  /** Nome de cada chave por dimensão; null = sem permissão para ver os nomes de negócio. */
  names: Record<ReportBreakdown, Map<string, string> | null>;
}

type Params = Record<string, string | null | undefined>;

/** Lê o período e a moeda dos parâmetros e carrega os dados (sempre no âmbito da sessão). null sem finance.read. */
export async function loadReport(session: SessionContext, m: Messages, params: Params): Promise<ReportData | null> {
  const fin = financeScope(session);
  if (!fin.canRead) return null;
  const biz = businessScope(session);
  const preset = REPORT_PRESETS.find((p) => p === params.periodo) ?? "month";
  const period = reportPeriod(preset, todayIn(fin.timezone), { from: params.de, to: params.ate });
  const db = session.supabase;

  const [reportRes, monthlyRes, categoriesRes, currenciesRes, contactsRes, projectsRes, centersRes] = await Promise.all([
    db.rpc("finance_report", { p_org: fin.orgId, p_from: period.from, p_to: period.to }),
    db.rpc("finance_monthly", { p_org: fin.orgId, p_from: period.from, p_to: period.to }),
    db.from("transaction_categories").select("id, key, name, is_system").or(`is_system.eq.true,${fin.column}.eq.${fin.value}`),
    db.from("currencies").select("code, minor_unit"),
    biz.canRead ? db.from("contacts").select("id, name").eq(biz.column, biz.value).limit(5000) : Promise.resolve({ data: null, error: null }),
    biz.canRead ? db.from("projects").select("id, name").eq(biz.column, biz.value).limit(5000) : Promise.resolve({ data: null, error: null }),
    biz.canRead ? db.from("cost_centers").select("id, name").eq(biz.column, biz.value).limit(5000) : Promise.resolve({ data: null, error: null }),
  ]);
  if (reportRes.error || monthlyRes.error) throw new Error("Falha ao carregar o relatório");

  const rows: ReportRow[] = (reportRes.data ?? []).map((r) => ({
    dimension: r.dimension as ReportDimension,
    key: r.key,
    currency: r.currency_code,
    incomeTotal: BigInt(r.income_total),
    incomeSettled: BigInt(r.income_settled),
    expenseTotal: BigInt(r.expense_total),
    expenseSettled: BigInt(r.expense_settled),
    count: Number(r.count),
  }));
  const currencies = reportCurrencies(rows, fin.defaultCurrency);
  const currency = currencies.find((c) => c === params.moeda) ?? currencies[0] ?? fin.defaultCurrency;
  const minorUnit = (currenciesRes.data ?? []).find((c) => c.code === currency)?.minor_unit ?? 2;
  const toMap = (list: { id: string; name: string }[] | null) => (list ? new Map(list.map((x) => [x.id, x.name])) : null);

  return {
    preset,
    period,
    currencies,
    currency,
    minorUnit,
    rows,
    monthly: (monthlyRes.data ?? [])
      .filter((x) => x.currency_code === currency)
      .map((x) => ({ month: x.month.slice(0, 7), income: BigInt(x.income), expense: BigInt(x.expense) })),
    names: {
      category: new Map((categoriesRes.data ?? []).map((c) => [c.id, categoryLabel(m, c)])),
      contact: toMap(contactsRes.data),
      project: toMap(projectsRes.data),
      cost_center: toMap(centersRes.data),
    },
  };
}

/** Nome de uma linha: sem chave → "Sem …"; sem permissão → aviso; senão o nome. */
export function reportName(m: Messages, data: ReportData, dimension: ReportBreakdown, key: string | null): string {
  if (key === null) return m.reports.none[dimension];
  const names = data.names[dimension];
  if (!names) return m.reports.hidden;
  return names.get(key) ?? m.reports.hidden;
}

/** Parâmetros do período atual, para ligações (CSV, mudança de moeda). */
export function reportQuery(data: ReportData, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ periodo: data.preset, moeda: data.currency, ...extra });
  if (data.preset === "custom") {
    p.set("de", data.period.from);
    p.set("ate", data.period.to);
  }
  return p.toString();
}
