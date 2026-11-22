import { type Decimal, decimal, decimalToString, divideRounded, pow10 } from "./decimal";

/**
 * Conversão entre unidades de medida conhecidas, para ligar um preço de fornecedor ("2,50 € / kg")
 * a um ingrediente medido noutra unidade ("g"). Só converte dentro da mesma grandeza
 * (massa, volume ou contagem); fora disso devolve null e o utilizador indica a correspondência.
 */
type Dimension = "mass" | "volume" | "count";

/** Fator em relação à unidade-base da grandeza (g, ml, un). */
const UNITS: Record<string, { dimension: Dimension; factor: string }> = {
  mg: { dimension: "mass", factor: "0.001" },
  g: { dimension: "mass", factor: "1" },
  gr: { dimension: "mass", factor: "1" },
  grama: { dimension: "mass", factor: "1" },
  gramas: { dimension: "mass", factor: "1" },
  kg: { dimension: "mass", factor: "1000" },
  quilo: { dimension: "mass", factor: "1000" },
  quilos: { dimension: "mass", factor: "1000" },
  ml: { dimension: "volume", factor: "1" },
  cl: { dimension: "volume", factor: "10" },
  dl: { dimension: "volume", factor: "100" },
  l: { dimension: "volume", factor: "1000" },
  lt: { dimension: "volume", factor: "1000" },
  litro: { dimension: "volume", factor: "1000" },
  litros: { dimension: "volume", factor: "1000" },
  un: { dimension: "count", factor: "1" },
  und: { dimension: "count", factor: "1" },
  unid: { dimension: "count", factor: "1" },
  unidade: { dimension: "count", factor: "1" },
  unidades: { dimension: "count", factor: "1" },
  dz: { dimension: "count", factor: "12" },
  duzia: { dimension: "count", factor: "12" },
  dúzia: { dimension: "count", factor: "12" },
};

/** Unidades que o motor conhece (a base de dados tem o mesmo quadro em private.unit_factor). */
export const KNOWN_UNITS: readonly string[] = Object.keys(UNITS);

export function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLocaleLowerCase("pt").replace(/\.$/, "");
}

/**
 * Quantas unidades `to` há numa unidade `from` (kg → g = 1000; l → ml = 1000; dúzia → un = 12).
 * Até 3 casas decimais (o máximo das quantidades nas fichas); null se a conversão não for conhecida
 * ou não for exata a 3 casas.
 */
export function unitConversionFactor(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = UNITS[normalizeUnit(from)];
  const b = UNITS[normalizeUnit(to)];
  if (!a || !b || a.dimension !== b.dimension) return null;
  const fa: Decimal = decimal(a.factor);
  const fb: Decimal = decimal(b.factor);
  // fa / fb com 3 casas; verificar que é exato.
  const scale = 3;
  const numerator = fa.coefficient * pow10(fb.scale + scale);
  const denominator = fb.coefficient * pow10(fa.scale);
  const coefficient = divideRounded(numerator, denominator, "half-up");
  if (coefficient * denominator !== numerator || coefficient <= 0n) return null;
  return decimalToString({ coefficient, scale }).replace(/\.?0+$/, "");
}
