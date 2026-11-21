import { type Decimal, compareDecimal, decimal, decimalToString, multiplyDecimal, rescale } from "./decimal";
import { priceFromMargin, markupPercent, marginPercent } from "./formulas";
import { type Money, MoneyError, add, allocate, compare, moneyFromMinor, percentOf, subtract, sum, zero } from "./money";

export const QUOTE_LINE_KINDS = ["material", "labor", "travel", "equipment", "overhead", "other"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

/** O que se vende na linha: produto (bem) ou serviço. */
export const QUOTE_LINE_NATURES = ["product", "service"] as const;
export type QuoteLineNature = (typeof QUOTE_LINE_NATURES)[number];

/** Natureza sugerida pelo tipo de custo; o utilizador pode mudar. */
export function defaultNature(kind: QuoteLineKind): QuoteLineNature {
  return kind === "material" || kind === "equipment" ? "product" : "service";
}

/** Desconto comercial: percentagem do preço sem imposto, ou valor fixo. */
export type QuoteDiscount = { type: "none" } | { type: "percent"; percent: string } | { type: "amount"; amountMinor: bigint };

export interface QuoteLineInput {
  kind: QuoteLineKind;
  /** Omisso: a natureza sugerida pelo tipo. */
  nature?: QuoteLineNature;
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
  discount?: QuoteDiscount;
}

export interface QuoteBreakdown {
  lineTotals: Money[];
  costByKind: Record<QuoteLineKind, Money>;
  directCost: Money;
  overheadCost: Money;
  totalCost: Money;
  /** Preço com a margem, antes do desconto. */
  subtotal: Money;
  discount: Money;
  /** Preço sem imposto já com o desconto (base do imposto e receita prevista). */
  priceBeforeTax: Money;
  /** Preço de cada linha antes do desconto, repartido pelo custo sem perder cêntimos. */
  linePrices: Money[];
  /** Preço antes do desconto por natureza (produtos e serviços). */
  subtotalByNature: Record<QuoteLineNature, Money>;
  /** O desconto deixa o preço abaixo do custo (lucro negativo). */
  belowCost: boolean;
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
  const subtotal = priceFromMargin(totalCost, margin, "half-up");
  const discount = computeDiscount(subtotal, input.discount ?? { type: "none" });
  const priceBeforeTax = subtract(subtotal, discount);
  const linePrices = allocateLinePrices(subtotal, lineTotals);
  const subtotalByNature = Object.fromEntries(QUOTE_LINE_NATURES.map((n) => [n, zero(currency)])) as Record<QuoteLineNature, Money>;
  input.lines.forEach((line, i) => {
    const nature = line.nature ?? defaultNature(line.kind);
    subtotalByNature[nature] = add(subtotalByNature[nature], linePrices[i]!);
  });
  const profit = subtract(priceBeforeTax, totalCost);
  const tax = percentOf(priceBeforeTax, taxRate, "half-up");
  const total = add(priceBeforeTax, tax);

  return {
    lineTotals,
    costByKind,
    directCost,
    overheadCost,
    totalCost,
    subtotal,
    discount,
    priceBeforeTax,
    linePrices,
    subtotalByNature,
    belowCost: compare(priceBeforeTax, totalCost) < 0,
    profit,
    tax,
    total,
    effectiveMarginPercent: marginPercent(profit, priceBeforeTax),
    effectiveMarkupPercent: markupPercent(profit, totalCost),
  };
}

/** Valor do desconto; nunca maior do que o preço a que se aplica. */
export function computeDiscount(subtotal: Money, discount: QuoteDiscount): Money {
  if (discount.type === "none") return zero(subtotal.currency);
  if (discount.type === "percent") {
    const p = decimal(discount.percent);
    if (p.coefficient < 0n || compareDecimal(p, decimal("100")) > 0) throw new MoneyError("Desconto inválido");
    return percentOf(subtotal, p, "half-up");
  }
  if (discount.amountMinor < 0n) throw new MoneyError("Desconto inválido");
  const value = moneyFromMinor(discount.amountMinor, subtotal.currency);
  if (compare(value, subtotal) > 0) throw new QuoteDiscountTooLargeError();
  return value;
}

export class QuoteDiscountTooLargeError extends MoneyError {
  constructor() {
    super("O desconto não pode ser maior do que o preço");
    this.name = "QuoteDiscountTooLargeError";
  }
}

/**
 * Reparte um preço pelas linhas na proporção do custo de cada uma, sem perder cêntimos.
 * Sem custos, todas as linhas ficam a zero.
 */
export function allocateLinePrices(price: Money, lineCosts: readonly Money[]): Money[] {
  const ratios = lineCosts.map((c) => c.amountMinor);
  if (!ratios.length || ratios.every((r) => r === 0n)) return lineCosts.map(() => zero(price.currency));
  return allocate(price, ratios);
}

export function percentToString(value: Decimal | null): string | null {
  return value === null ? null : decimalToString(value);
}
