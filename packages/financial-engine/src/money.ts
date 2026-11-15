import {
  type Decimal,
  type RoundingMode,
  DecimalError,
  decimal,
  divideRounded,
  multiplyDecimal,
  pow10,
  rescale,
  decimalToString,
} from "./decimal";

/**
 * Valor monetário guardado em unidades mínimas inteiras (ex.: cêntimos/centavos),
 * sempre acompanhado da moeda. Nunca há ponto flutuante.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

/**
 * Casas decimais por moeda (ISO 4217). A fonte de verdade em produção é a tabela
 * `public.currencies`; este registo é inicializado com as moedas suportadas e pode
 * ser atualizado a partir da base de dados com `registerCurrency`.
 */
const minorUnits = new Map<string, number>([
  ["EUR", 2],
  ["BRL", 2],
  ["USD", 2],
]);

export function registerCurrency(code: string, minorUnit: number): void {
  if (!/^[A-Z]{3}$/.test(code)) throw new MoneyError(`Código de moeda inválido: ${code}`);
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 4) {
    throw new MoneyError(`Casas decimais inválidas para ${code}: ${minorUnit}`);
  }
  minorUnits.set(code, minorUnit);
}

export function minorUnitOf(currency: string): number {
  const unit = minorUnits.get(currency);
  if (unit === undefined) throw new MoneyError(`Moeda não suportada: ${currency}`);
  return unit;
}

export function moneyFromMinor(amountMinor: bigint, currency: string): Money {
  minorUnitOf(currency);
  return { amountMinor, currency };
}

/**
 * Cria Money a partir de texto decimal ("1234.56"). Rejeita precisão superior à da moeda
 * para nunca arredondar silenciosamente um valor introduzido pelo utilizador.
 */
export function money(amount: string, currency: string): Money {
  const unit = minorUnitOf(currency);
  const value = decimal(amount);
  if (value.scale > unit) {
    const rounded = rescale(value, unit, "down");
    if (rescale(rounded, value.scale).coefficient !== value.coefficient) {
      throw new MoneyError(`${currency} aceita no máximo ${unit} casas decimais`);
    }
  }
  return { amountMinor: rescale(value, unit).coefficient, currency };
}

export function zero(currency: string): Money {
  return moneyFromMinor(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Moedas diferentes: ${a.currency} e ${b.currency}. Converta antes de operar.`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sum(values: readonly Money[], currency: string): Money {
  return values.reduce<Money>((acc, value) => add(acc, value), zero(currency));
}

export function negate(value: Money): Money {
  return { amountMinor: -value.amountMinor, currency: value.currency };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0n;
}

export function isNegative(value: Money): boolean {
  return value.amountMinor < 0n;
}

/** Multiplica por um fator decimal exato (quantidade, taxa…) e arredonda à unidade mínima. */
export function multiply(value: Money, factor: string | Decimal, mode: RoundingMode = "half-up"): Money {
  const f = typeof factor === "string" ? decimal(factor) : factor;
  const product = multiplyDecimal({ coefficient: value.amountMinor, scale: 0 }, f);
  return { amountMinor: rescale(product, 0, mode).coefficient, currency: value.currency };
}

/** Percentagem de um valor: percentOf(100,00 €, "23") = 23,00 €. */
export function percentOf(value: Money, percent: string | Decimal, mode: RoundingMode = "half-up"): Money {
  const p = typeof percent === "string" ? decimal(percent) : percent;
  const product = multiplyDecimal({ coefficient: value.amountMinor, scale: 0 }, p);
  return {
    amountMinor: divideRounded(product.coefficient, pow10(product.scale) * 100n, mode),
    currency: value.currency,
  };
}

/**
 * Reparte um valor por proporções inteiras sem perder nem criar cêntimos
 * (método do maior resto). A soma das partes é sempre igual ao total.
 */
export function allocate(value: Money, ratios: readonly bigint[]): Money[] {
  if (ratios.length === 0) throw new MoneyError("Indique pelo menos uma proporção");
  if (ratios.some((r) => r < 0n)) throw new MoneyError("Proporções não podem ser negativas");
  const total = ratios.reduce((a, b) => a + b, 0n);
  if (total === 0n) throw new MoneyError("A soma das proporções não pode ser zero");

  const negative = value.amountMinor < 0n;
  const amount = negative ? -value.amountMinor : value.amountMinor;
  const shares = ratios.map((ratio, index) => ({
    index,
    base: (amount * ratio) / total,
    remainder: (amount * ratio) % total,
  }));
  let leftover = amount - shares.reduce((acc, s) => acc + s.base, 0n);
  const order = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const extra = new Map<number, bigint>();
  for (const share of order) {
    if (leftover === 0n) break;
    extra.set(share.index, 1n);
    leftover -= 1n;
  }
  return shares.map((s) => {
    const part = s.base + (extra.get(s.index) ?? 0n);
    return { amountMinor: negative ? -part : part, currency: value.currency };
  });
}

/** Representação decimal exata ("1234.56"), útil para APIs e PDFs. */
export function toDecimalString(value: Money): string {
  return decimalToString({ coefficient: value.amountMinor, scale: minorUnitOf(value.currency) });
}

export function toDecimal(value: Money): Decimal {
  return { coefficient: value.amountMinor, scale: minorUnitOf(value.currency) };
}

export { DecimalError };
