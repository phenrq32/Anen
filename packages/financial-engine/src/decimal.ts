/**
 * Decimal exato em base 10: valor = coefficient / 10^scale.
 * Sem ponto flutuante em nenhum passo. Entradas aceites apenas como string ou bigint.
 */
export interface Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

export type RoundingMode = "half-up" | "half-even" | "down" | "up";

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SCALE = 18;

export class DecimalError extends Error {
  override name = "DecimalError";
}

export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new DecimalError(`Expoente inválido: ${n}`);
  return 10n ** BigInt(n);
}

export function decimal(input: string | bigint | Decimal): Decimal {
  if (typeof input === "bigint") return { coefficient: input, scale: 0 };
  if (typeof input === "object") return input;
  const match = DECIMAL_PATTERN.exec(input.trim());
  if (!match) throw new DecimalError(`Valor decimal inválido: "${input}"`);
  const [, sign, intPart = "0", fracPart = ""] = match;
  if (fracPart.length > MAX_SCALE) throw new DecimalError(`Precisão máxima de ${MAX_SCALE} casas excedida`);
  const coefficient = BigInt(intPart + fracPart) * (sign === "-" ? -1n : 1n);
  return { coefficient, scale: fracPart.length };
}

/** Divide n por d (d ≠ 0) arredondando para inteiro segundo o modo indicado. */
export function divideRounded(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new DecimalError("Divisão por zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const absN = negative ? -n : n;
  let q = absN / d;
  const r = absN % d;
  if (r !== 0n) {
    const twice = r * 2n;
    switch (mode) {
      case "down":
        break;
      case "up":
        q += 1n;
        break;
      case "half-up":
        if (twice >= d) q += 1n;
        break;
      case "half-even":
        if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
        break;
    }
  }
  return negative ? -q : q;
}

export function rescale(value: Decimal, scale: number, mode: RoundingMode = "half-up"): Decimal {
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    return { coefficient: value.coefficient * pow10(scale - value.scale), scale };
  }
  return { coefficient: divideRounded(value.coefficient, pow10(value.scale - scale), mode), scale };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale).coefficient, rescale(b, scale).coefficient, scale];
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { coefficient: x + y, scale };
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { coefficient: x - y, scale };
}

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
}

/** a / b com o número de casas pedido. */
export function divideDecimal(a: Decimal, b: Decimal, scale: number, mode: RoundingMode = "half-up"): Decimal {
  if (b.coefficient === 0n) throw new DecimalError("Divisão por zero");
  // a/b = (ca/10^sa) / (cb/10^sb) ; resultado com `scale` casas:
  // coef = ca * 10^(sb + scale) / (cb * 10^sa)
  const numerator = a.coefficient * pow10(b.scale + scale);
  const denominator = b.coefficient * pow10(a.scale);
  return { coefficient: divideRounded(numerator, denominator, mode), scale };
}

export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function decimalToString(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return (negative ? "-" : "") + digits;
  const padded = digits.padStart(value.scale + 1, "0");
  const intPart = padded.slice(0, padded.length - value.scale);
  const fracPart = padded.slice(padded.length - value.scale);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}
