import { type Decimal, compareDecimal, decimal, decimalToString, multiplyDecimal, rescale } from "./decimal";
import { priceFromMargin, markupPercent, marginPercent } from "./formulas";
import { type Money, MoneyError, add, moneyFromMinor, percentOf, subtract, sum, zero } from "./money";

export const QUOTE_LINE_KINDS = ["material", "labor", "travel", "equipment", "overhead", "other"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export interface QuoteLineInput {
  kind: QuoteLineKind;
  /** Quantidade decimal exata ("2.5" horas, "90" m², "34" km). */
  quantity: string;
  unitCostMinor: bigint;
}

export interface QuoteInput {
  currency: string;
  lines: QuoteLineInput[];
  /** Margem sobre o preço de venda, em % (0 ≤ margem < 100). */
  marginPercent: string;
  /** Taxa de imposto indicada pelo utilizador, em % (≥ 0). */
  taxRatePercent: string;
}

export interface QuoteBreakdown {
  lineTotals: Money[];
  costByKind: Record<QuoteLineKind, Money>;
  directCost: Money;
  overheadCost: Money;
  totalCost: Money;
  priceBeforeTax: Money;
  profit: Money;
  tax: Money;
  total: Money;
  /** Margem e markup efetivos após arredondamentos, em % com 2 casas. */
  effectiveMarginPercent: Decimal | null;
  effectiveMarkupPercent: Decimal | null;
}

const MAX_QUANTITY = decimal("1000000000");

/** Custo de uma linha: quantidade × custo unitário, arredondado à unidade mínima (meio para cima). */
export function lineTotal(line: QuoteLineInput, currency: string): Money {
  const quantity = decimal(line.quantity);
  if (quantity.coefficient < 0n || compareDecimal(quantity, MAX_QUANTITY) > 0) {
    throw new MoneyError("Quantidade inválida");
  }
  if (line.unitCostMinor < 0n) throw new MoneyError("Custo unitário inválido");
  const product = multiplyDecimal({ coefficient: line.unitCostMinor, scale: 0 }, quantity);
  return moneyFromMinor(rescale(product, 0, "half-up").coefficient, currency);
}

/**
 * Calcula um orçamento: custos por tipo, custo total, preço com a margem pretendida,
 * imposto e total. Determinístico e sem ponto flutuante.
 */
export function computeQuote(input: QuoteInput): QuoteBreakdown {
  const { currency } = input;
  const margin = decimal(input.marginPercent);
  const taxRate = decimal(input.taxRatePercent);
  if (margin.coefficient < 0n || compareDecimal(margin, decimal("100")) >= 0) {
    throw new MoneyError("A margem tem de estar entre 0 e 100 %");
  }
  if (taxRate.coefficient < 0n || compareDecimal(taxRate, decimal("100")) > 0) {
    throw new MoneyError("Taxa de imposto inválida");
  }

  const lineTotals = input.lines.map((l) => lineTotal(l, currency));
  const costByKind = Object.fromEntries(QUOTE_LINE_KINDS.map((k) => [k, zero(currency)])) as Record<QuoteLineKind, Money>;
  input.lines.forEach((line, i) => {
    costByKind[line.kind] = add(costByKind[line.kind], lineTotals[i]!);
  });
  const overheadCost = costByKind.overhead;
  const directCost = subtract(sum(lineTotals, currency), overheadCost);
  const totalCost = add(directCost, overheadCost);
  const priceBeforeTax = priceFromMargin(totalCost, margin, "half-up");
  const profit = subtract(priceBeforeTax, totalCost);
  const tax = percentOf(priceBeforeTax, taxRate, "half-up");
  const total = add(priceBeforeTax, tax);

  return {
    lineTotals,
    costByKind,
    directCost,
    overheadCost,
    totalCost,
    priceBeforeTax,
    profit,
    tax,
    total,
    effectiveMarginPercent: marginPercent(profit, priceBeforeTax),
    effectiveMarkupPercent: markupPercent(profit, totalCost),
  };
}

export function percentToString(value: Decimal | null): string | null {
  return value === null ? null : decimalToString(value);
}
