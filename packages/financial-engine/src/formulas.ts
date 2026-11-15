import { type Decimal, type RoundingMode, decimal, divideRounded, pow10, compareDecimal } from "./decimal";
import { type Money, MoneyError, add, subtract, sum } from "./money";

/** Custo total = custos diretos + custos indiretos. */
export function totalCost(direct: readonly Money[], indirect: readonly Money[], currency: string): Money {
  return add(sum(direct, currency), sum(indirect, currency));
}

/** Lucro bruto = receita - custos diretos. */
export function grossProfit(revenue: Money, directCosts: readonly Money[]): Money {
  return subtract(revenue, sum(directCosts, revenue.currency));
}

/** Resultado operacional = receita - custos operacionais. */
export function operatingResult(revenue: Money, operatingCosts: readonly Money[]): Money {
  return subtract(revenue, sum(operatingCosts, revenue.currency));
}

function ratioPercent(numerator: Money, denominator: Money, scale: number, mode: RoundingMode): Decimal | null {
  if (numerator.currency !== denominator.currency) {
    throw new MoneyError(`Moedas diferentes: ${numerator.currency} e ${denominator.currency}`);
  }
  if (denominator.amountMinor === 0n) return null;
  return {
    coefficient: divideRounded(numerator.amountMinor * 100n * pow10(scale), denominator.amountMinor, mode),
    scale,
  };
}

/**
 * Margem percentual = lucro / receita × 100.
 * Devolve null quando a receita é zero (margem indefinida).
 */
export function marginPercent(profit: Money, revenue: Money, scale = 2, mode: RoundingMode = "half-up"): Decimal | null {
  return ratioPercent(profit, revenue, scale, mode);
}

/**
 * Markup = lucro / custo × 100.
 * Diferente da margem: um markup de 25 % corresponde a uma margem de 20 %.
 * Devolve null quando o custo é zero.
 */
export function markupPercent(profit: Money, cost: Money, scale = 2, mode: RoundingMode = "half-up"): Decimal | null {
  return ratioPercent(profit, cost, scale, mode);
}

/** Preço de venda a partir do custo e de um markup: preço = custo × (1 + markup/100). */
export function priceFromMarkup(cost: Money, markup: string | Decimal, mode: RoundingMode = "half-up"): Money {
  const m = typeof markup === "string" ? decimal(markup) : markup;
  // custo × (100 + m) / 100
  const factorNumerator = 100n * pow10(m.scale) + m.coefficient;
  return {
    amountMinor: divideRounded(cost.amountMinor * factorNumerator, 100n * pow10(m.scale), mode),
    currency: cost.currency,
  };
}

/**
 * Preço de venda a partir do custo e de uma margem desejada: preço = custo / (1 - margem/100).
 * A margem tem de ser inferior a 100 %.
 */
export function priceFromMargin(cost: Money, margin: string | Decimal, mode: RoundingMode = "half-up"): Money {
  const m = typeof margin === "string" ? decimal(margin) : margin;
  if (compareDecimal(m, decimal("100")) >= 0) {
    throw new MoneyError("A margem tem de ser inferior a 100 %");
  }
  const denominator = 100n * pow10(m.scale) - m.coefficient;
  return {
    amountMinor: divideRounded(cost.amountMinor * 100n * pow10(m.scale), denominator, mode),
    currency: cost.currency,
  };
}
