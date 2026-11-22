import { compareDecimal, decimal, type Decimal } from "./decimal";
import { categoryChanges, findPossibleDuplicates, type CategoryTotal, type ExpenseLike } from "./insights";
import { moneyFromMinor, type Money } from "./money";
import type { PriceSeries } from "./price-history";

/**
 * Centro de inteligência: recomendações determinísticas a partir dos dados registados.
 * Cada recomendação diz o que foi identificado, os dados que a sustentam, o impacto (quando há valor),
 * a ação sugerida (ligação) e o grau de confiança. Nada aqui é estimado por um modelo.
 * Moedas nunca se misturam: cada recomendação tem a sua.
 */

export interface IntelligencePeriod {
  from: string;
  to: string;
}

const DAY = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Janela móvel de `days` dias a terminar em `today` (inclusive) e a janela anterior com o mesmo comprimento. */
export function rollingPeriods(today: string, days: number): { current: IntelligencePeriod; previous: IntelligencePeriod } {
  const n = Math.max(1, Math.floor(days));
  const end = msOf(today);
  const start = end - (n - 1) * DAY;
  return {
    current: { from: isoOf(start), to: today },
    previous: { from: isoOf(start - n * DAY), to: isoOf(start - DAY) },
  };
}

export interface PeriodTotals {
  currency: string;
  income: bigint;
  expense: bigint;
  count: number;
}

export interface OpenItem {
  kind: "income" | "expense";
  remainingMinor: bigint;
  currency: string;
  dueOn: string | null;
}

export interface ProjectOverBudget {
  id: string;
  name: string;
  costVariance: Money;
}

export interface IntelligenceInput {
  today: string;
  current: IntelligencePeriod;
  previous: IntelligencePeriod;
  /** Moeda principal (as comparações por categoria usam-na). */
  currency: string;
  /** null quando a pessoa não pode ver as finanças neste contexto. */
  finance: {
    current: PeriodTotals[];
    previous: PeriodTotals[];
    expenseByCategory: { current: CategoryTotal[]; previous: CategoryTotal[] };
    expenses: ExpenseLike[];
    open: OpenItem[];
  } | null;
  /** null quando a pessoa não pode ver negócio (stock, projetos, fornecedores). */
  business: {
    lowStockCount: number;
    projectsOverBudget: ProjectOverBudget[];
    priceSeries: PriceSeries[];
  } | null;
}

export type RecommendationKind =
  | "negative_result"
  | "income_drop"
  | "expense_increase"
  | "overdue_receivables"
  | "overdue_payables"
  | "payables_due_soon"
  | "possible_duplicates"
  | "low_stock"
  | "project_over_budget"
  | "supplier_price_increase"
  | "no_movements";

export type Level = "high" | "medium" | "low";

export interface Recommendation {
  kind: RecommendationKind;
  severity: Level;
  confidence: Level;
  /** Valor em causa (impacto), quando existe. */
  impact: Money | null;
  /** Quantidade de registos envolvidos. */
  count: number;
  /** Nome do que está em causa (categoria, projeto, artigo), quando aplicável. Categoria pode ser null (sem categoria). */
  subject?: string | null;
  /** Variação percentual (2 casas), quando aplicável. */
  percent?: Decimal | null;
  /** Valores de suporte (antes/depois), quando aplicável. */
  before?: Money;
  after?: Money;
  /** Para onde a ação leva. */
  href: string;
}

/** Limiares (variação mínima para assinalar). Em %, inteiros. */
export const THRESHOLDS = {
  expenseIncreasePercent: 20n,
  incomeDropPercent: 20n,
  priceIncreasePercent: 5n,
  dueSoonDays: 7,
  maxExpenseIncreases: 3,
  maxProjects: 3,
  maxPriceIncreases: 3,
} as const;

const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };

/** Percentagem inteira de a sobre b (b > 0), sem ponto flutuante: (a·100)/b truncado. */
const percentOf = (a: bigint, b: bigint) => (a * 100n) / b;

export function buildRecommendations(input: IntelligenceInput): Recommendation[] {
  const out: Recommendation[] = [];
  const { finance, business } = input;
  const reportHref = `/relatorios?periodo=custom&de=${input.current.from}&ate=${input.current.to}`;

  if (finance) {
    const totalCount = finance.current.reduce((s, t) => s + t.count, 0);
    if (totalCount === 0) {
      out.push({ kind: "no_movements", severity: "low", confidence: "high", impact: null, count: 0, href: "/financas/movimentos" });
    }

    for (const cur of finance.current) {
      const result = cur.income - cur.expense;
      if (cur.count > 0 && result < 0n) {
        out.push({
          kind: "negative_result",
          severity: "high",
          confidence: "high",
          impact: moneyFromMinor(-result, cur.currency),
          count: cur.count,
          before: moneyFromMinor(cur.income, cur.currency),
          after: moneyFromMinor(cur.expense, cur.currency),
          href: reportHref,
        });
      }
      const prev = finance.previous.find((p) => p.currency === cur.currency);
      if (prev && prev.income > 0n && cur.income < prev.income) {
        const drop = percentOf(prev.income - cur.income, prev.income);
        if (drop >= THRESHOLDS.incomeDropPercent) {
          out.push({
            kind: "income_drop",
            severity: "medium",
            // Com poucos movimentos a variação pode ser só calendário.
            confidence: prev.count + cur.count >= 6 ? "high" : "medium",
            impact: moneyFromMinor(prev.income - cur.income, cur.currency),
            count: cur.count,
            percent: decimal(-drop),
            before: moneyFromMinor(prev.income, cur.currency),
            after: moneyFromMinor(cur.income, cur.currency),
            href: reportHref,
          });
        }
      }
    }

    const changes = categoryChanges(finance.expenseByCategory.previous, finance.expenseByCategory.current, input.currency)
      .filter(
        (c) =>
          c.change.amountMinor > 0n &&
          c.previous.amountMinor > 0n &&
          c.changePercent !== null &&
          compareDecimal(c.changePercent, decimal(THRESHOLDS.expenseIncreasePercent)) >= 0,
      )
      .slice(0, THRESHOLDS.maxExpenseIncreases);
    for (const c of changes) {
      out.push({
        kind: "expense_increase",
        severity: "medium",
        confidence: "high",
        impact: c.change,
        count: 0,
        subject: c.key,
        percent: c.changePercent,
        before: c.previous,
        after: c.current,
        href: reportHref,
      });
    }

    // Pendentes por moeda: atrasados (a receber / a pagar) e a pagar nos próximos dias.
    const soonLimit = isoOf(msOf(input.today) + THRESHOLDS.dueSoonDays * DAY);
    const buckets = new Map<string, { kind: RecommendationKind; total: bigint; count: number; currency: string }>();
    for (const o of finance.open) {
      if (o.remainingMinor <= 0n || o.dueOn === null) continue;
      let kind: RecommendationKind | null = null;
      if (o.dueOn < input.today) kind = o.kind === "income" ? "overdue_receivables" : "overdue_payables";
      else if (o.kind === "expense" && o.dueOn <= soonLimit) kind = "payables_due_soon";
      if (!kind) continue;
      const k = `${kind}|${o.currency}`;
      const b = buckets.get(k) ?? { kind, total: 0n, count: 0, currency: o.currency };
      b.total += o.remainingMinor;
      b.count += 1;
      buckets.set(k, b);
    }
    for (const b of buckets.values()) {
      out.push({
        kind: b.kind,
        severity: b.kind === "payables_due_soon" ? "medium" : "high",
        confidence: "high",
        impact: moneyFromMinor(b.total, b.currency),
        count: b.count,
        href: "/financas/em-aberto",
      });
    }

    const inPeriod = finance.expenses.filter((e) => e.occurredOn >= input.current.from && e.occurredOn <= input.current.to);
    const groups = findPossibleDuplicates(inPeriod);
    const dupByCurrency = new Map<string, { total: bigint; count: number }>();
    for (const g of groups) {
      const first = g[0]!;
      const d = dupByCurrency.get(first.currency) ?? { total: 0n, count: 0 };
      // Impacto: o valor das repetições (todas menos a primeira).
      d.total += first.amountMinor * BigInt(g.length - 1);
      d.count += g.length;
      dupByCurrency.set(first.currency, d);
    }
    for (const [currency, d] of dupByCurrency) {
      out.push({
        kind: "possible_duplicates",
        severity: "medium",
        // É uma suspeita: só a pessoa confirma se é mesmo duplicado.
        confidence: "medium",
        impact: moneyFromMinor(d.total, currency),
        count: d.count,
        href: `/financas/movimentos?tipo=expense&mes=${input.current.to.slice(0, 7)}`,
      });
    }
  }

  if (business) {
    if (business.lowStockCount > 0) {
      out.push({ kind: "low_stock", severity: "medium", confidence: "high", impact: null, count: business.lowStockCount, href: "/inventario" });
    }
    for (const p of business.projectsOverBudget.slice(0, THRESHOLDS.maxProjects)) {
      out.push({
        kind: "project_over_budget",
        severity: "high",
        confidence: "high",
        impact: p.costVariance,
        count: 1,
        subject: p.name,
        href: `/projetos/${p.id}`,
      });
    }
    const rises = business.priceSeries
      .filter(
        (s) =>
          s.latestOn >= input.current.from &&
          s.latestOn <= input.current.to &&
          s.change !== null &&
          s.change.amountMinor > 0n &&
          s.changePercent !== null &&
          compareDecimal(s.changePercent, decimal(THRESHOLDS.priceIncreasePercent)) >= 0,
      )
      .sort((a, b) => compareDecimal(b.changePercent!, a.changePercent!))
      .slice(0, THRESHOLDS.maxPriceIncreases);
    for (const s of rises) {
      out.push({
        kind: "supplier_price_increase",
        severity: "medium",
        // Dois registos bastam para ver a subida; com mais histórico a tendência é mais sólida.
        confidence: s.points.length >= 3 ? "high" : "medium",
        impact: s.change,
        count: s.points.length,
        subject: s.unit ? `${s.itemName} (${s.unit})` : s.itemName,
        percent: s.changePercent,
        ...(s.previous ? { before: s.previous } : {}),
        after: s.latest,
        href: "/compras",
      });
    }
  }

  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => RANK[a.r.severity] - RANK[b.r.severity] || a.i - b.i)
    .map(({ r }) => r);
}
