import { type Decimal, decimal, multiplyDecimal, pow10, rescale } from "./decimal";

/**
 * Leitura de séries oficiais de mercado (índices e custos médios). Os valores vêm tal como a fonte
 * os publica; aqui só se fazem contas determinísticas sobre eles, sem ponto flutuante.
 */
export interface MarketPoint {
  /** AAAA-MM-01 */
  period: string;
  value: string | null;
  changeMonth: string | null;
  changeYear: string | null;
}

export interface MarketReading {
  latest: MarketPoint;
  previous: MarketPoint | null;
  /** Variação acumulada nos últimos 3 meses publicados (consecutivos), em % com 2 casas. */
  change3Months: Decimal | null;
  direction: "up" | "down" | "stable" | null;
  /** Até 12 pontos, do mais antigo para o mais recente. */
  recent: MarketPoint[];
}

/** Composição de taxas mensais em %: (Π(1 + r/100) − 1) × 100, arredondada a 2 casas (meio para cima). */
export function compoundPercent(rates: readonly string[]): Decimal {
  let factor: Decimal = { coefficient: 1n, scale: 0 };
  for (const r of rates) {
    const rate = decimal(r);
    // 1 + r/100
    const step: Decimal = { coefficient: rate.coefficient + 100n * pow10(rate.scale), scale: rate.scale + 2 };
    factor = multiplyDecimal(factor, step);
  }
  const percent: Decimal = { coefficient: (factor.coefficient - pow10(factor.scale)) * 100n, scale: factor.scale };
  return rescale(percent, 2, "half-up");
}

function nextMonth(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Resumo de uma série: último valor, anterior, acumulado de 3 meses e sentido da variação mensal. */
export function readMarketSeries(points: readonly MarketPoint[], stableBand = "0.1"): MarketReading | null {
  const sorted = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const previous = sorted[sorted.length - 2] ?? null;
  const last3 = sorted.slice(-3);
  const consecutive = last3.length === 3 && nextMonth(last3[0]!.period) === last3[1]!.period && nextMonth(last3[1]!.period) === last3[2]!.period;
  const change3Months =
    consecutive && last3.every((p) => p.changeMonth !== null) ? compoundPercent(last3.map((p) => p.changeMonth!)) : null;
  let direction: MarketReading["direction"] = null;
  if (latest.changeMonth !== null) {
    const c = decimal(latest.changeMonth);
    const band = decimal(stableBand);
    const abs = c.coefficient < 0n ? { ...c, coefficient: -c.coefficient } : c;
    const s = Math.max(abs.scale, band.scale);
    const cmp = rescale(abs, s).coefficient - rescale(band, s).coefficient;
    direction = cmp < 0n ? "stable" : c.coefficient > 0n ? "up" : "down";
  }
  return { latest, previous, change3Months, direction, recent: sorted.slice(-12) };
}
