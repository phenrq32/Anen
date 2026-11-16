import type { Decimal } from "./decimal";
import { marginPercent } from "./formulas";
import { type Money, MoneyError, add, compare, moneyFromMinor, subtract, zero } from "./money";
import { QUOTE_LINE_KINDS, type QuoteLineKind } from "./quote";

/**
 * Previsto vs. real de um projeto. Determinístico e sem ponto flutuante.
 *
 * - Previsto: custo e receita (sem imposto) do orçamento aceite ou indicados pelo utilizador.
 * - Real: movimentos ligados ao projeto. As despesas contam pelo valor total (custo incorrido,
 *   pago ou não). As receitas contam pelo valor faturado e pelo valor efetivamente recebido.
 * - Os valores com imposto separado entram pelo valor sem imposto (o imposto não é custo nem receita).
 */
export interface ProjectMovement {
  kind: "income" | "expense";
  amountMinor: bigint;
  /** Valor sem imposto, quando indicado. */
  netMinor: bigint | null;
  settledMinor: bigint;
  costKind: QuoteLineKind | null;
  currency: string;
}

export interface ProjectPlan {
  currency: string;
  plannedCostMinor: bigint;
  plannedRevenueMinor: bigint;
  /** Custo previsto por tipo (das linhas do orçamento), quando existe orçamento. */
  plannedByKind?: Partial<Record<QuoteLineKind, bigint>>;
}

export type CostKindKey = QuoteLineKind | "unclassified";

export interface KindVariance {
  kind: CostKindKey;
  planned: Money;
  actual: Money;
  /** actual − planned: positivo = acima do previsto. */
  variance: Money;
  /** Desvio em % do previsto; null se não havia previsto. */
  variancePercent: Decimal | null;
}

export interface ProjectFinancials {
  plannedCost: Money;
  actualCost: Money;
  costVariance: Money;
  costVariancePercent: Decimal | null;
  plannedRevenue: Money;
  invoicedRevenue: Money;
  receivedRevenue: Money;
  outstandingRevenue: Money;
  unpaidCost: Money;
  plannedProfit: Money;
  /** Receita faturada − custo incorrido. */
  actualProfit: Money;
  plannedMarginPercent: Decimal | null;
  actualMarginPercent: Decimal | null;
  byKind: KindVariance[];
  /** O custo real já ultrapassa o custo previsto. */
  overBudget: boolean;
  /** Percentagem do custo previsto já consumida; null se não havia previsto. */
  budgetUsedPercent: Decimal | null;
}

function variancePercent(actual: Money, planned: Money): Decimal | null {
  if (planned.amountMinor === 0n) return null;
  return marginPercent(subtract(actual, planned), planned);
}

/** Valor que conta como custo ou receita: sem imposto quando indicado. */
function economicValue(m: ProjectMovement): bigint {
  return m.netMinor ?? m.amountMinor;
}

export function computeProjectFinancials(plan: ProjectPlan, movements: readonly ProjectMovement[]): ProjectFinancials {
  const { currency } = plan;
  const money = (v: bigint) => moneyFromMinor(v, currency);
  let actualCost = zero(currency);
  let unpaidCost = zero(currency);
  let invoiced = zero(currency);
  let received = zero(currency);
  const actualByKind = new Map<CostKindKey, Money>();

  for (const m of movements) {
    if (m.currency !== currency) throw new MoneyError(`Movimento em ${m.currency} num projeto em ${currency}`);
    const value = money(economicValue(m));
    if (m.kind === "expense") {
      actualCost = add(actualCost, value);
      unpaidCost = add(unpaidCost, money(m.amountMinor - m.settledMinor));
      const key: CostKindKey = m.costKind ?? "unclassified";
      actualByKind.set(key, add(actualByKind.get(key) ?? zero(currency), value));
    } else {
      invoiced = add(invoiced, value);
      // Recebido proporcional ao valor sem imposto: recebido × (líquido / total), arredondado para baixo.
      const settledNet = m.netMinor === null || m.amountMinor === 0n ? m.settledMinor : (m.settledMinor * m.netMinor) / m.amountMinor;
      received = add(received, money(settledNet));
    }
  }

  const plannedCost = money(plan.plannedCostMinor);
  const plannedRevenue = money(plan.plannedRevenueMinor);
  const plannedProfit = subtract(plannedRevenue, plannedCost);
  const actualProfit = subtract(invoiced, actualCost);

  const kinds: CostKindKey[] = [...QUOTE_LINE_KINDS, "unclassified"];
  const byKind: KindVariance[] = [];
  for (const kind of kinds) {
    const planned = money(kind === "unclassified" ? 0n : (plan.plannedByKind?.[kind] ?? 0n));
    const actual = actualByKind.get(kind) ?? zero(currency);
    if (planned.amountMinor === 0n && actual.amountMinor === 0n) continue;
    byKind.push({ kind, planned, actual, variance: subtract(actual, planned), variancePercent: variancePercent(actual, planned) });
  }

  const outstanding = subtract(invoiced, received);
  return {
    plannedCost,
    actualCost,
    costVariance: subtract(actualCost, plannedCost),
    costVariancePercent: variancePercent(actualCost, plannedCost),
    plannedRevenue,
    invoicedRevenue: invoiced,
    receivedRevenue: received,
    outstandingRevenue: outstanding,
    unpaidCost,
    plannedProfit,
    actualProfit,
    plannedMarginPercent: marginPercent(plannedProfit, plannedRevenue),
    actualMarginPercent: marginPercent(actualProfit, invoiced),
    byKind,
    overBudget: plannedCost.amountMinor > 0n && compare(actualCost, plannedCost) > 0,
    budgetUsedPercent: plannedCost.amountMinor === 0n ? null : marginPercent(actualCost, plannedCost),
  };
}
