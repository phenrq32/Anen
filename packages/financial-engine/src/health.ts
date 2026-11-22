/**
 * Saúde financeira: nota de 0 a 100 a partir de três sinais, todos dos registos da pessoa.
 * Inteiros e bigint, sem ponto flutuante. Cada parte é devolvida para a interface explicar a nota.
 *
 * - Poupança (40 pontos): (receitas − despesas) ÷ receitas do mês. 20 % ou mais = 40; 0 % ou menos = 0; linear entre.
 * - Reserva (30 pontos): saldo ÷ despesa média mensal. 6 meses ou mais = 30; 0 = 0; linear entre.
 * - Em dia (30 pontos): 30 sem nada em atraso; menos 10 por cada movimento em atraso (mínimo 0).
 *
 * Sem receitas nem despesas no mês e sem histórico de despesas não há base: devolve null.
 */
export interface HealthInput {
  income: bigint;
  expense: bigint;
  balance: bigint;
  /** Despesa média mensal dos meses anteriores (unidades mínimas). */
  averageMonthlyExpense: bigint;
  overdueCount: number;
}

export type HealthBand = "excellent" | "good" | "attention" | "critical";

export interface HealthScore {
  score: number;
  band: HealthBand;
  parts: {
    savings: { points: number; max: 40; ratePercent: number | null };
    reserve: { points: number; max: 30; months: number | null };
    onTime: { points: number; max: 30; overdue: number };
  };
}

const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

export function healthBand(score: number): HealthBand {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "attention";
  return "critical";
}

export function financialHealth(input: HealthInput): HealthScore | null {
  if (input.income === 0n && input.expense === 0n && input.averageMonthlyExpense <= 0n) return null;

  // Poupança: taxa em décimas de ponto percentual para não perder precisão; 20 % → 40 pontos (2 pontos por ponto %).
  let savingsPoints = 0;
  let ratePercent: number | null = null;
  if (input.income > 0n) {
    const rate = ((input.income - input.expense) * 100n) / input.income; // % inteiro, truncado
    ratePercent = Number(rate);
    savingsPoints = Number(clamp(rate * 2n, 0n, 40n));
  }

  // Reserva: meses de despesa cobertos pelo saldo; 6 meses → 30 pontos (5 por mês), proporcional em décimas de mês.
  let reservePoints = 0;
  let months: number | null = null;
  const base = input.averageMonthlyExpense > 0n ? input.averageMonthlyExpense : input.expense;
  if (base > 0n) {
    const tenths = (input.balance > 0n ? input.balance * 10n : 0n) / base; // meses × 10
    months = Number(tenths) / 10;
    reservePoints = Number(clamp(tenths / 2n, 0n, 30n)); // 60 décimas = 30 pontos
  } else if (input.balance > 0n) {
    months = null;
    reservePoints = 30;
  }

  const overdue = Math.max(0, Math.floor(input.overdueCount));
  const onTimePoints = Math.max(0, 30 - overdue * 10);

  const score = savingsPoints + reservePoints + onTimePoints;
  return {
    score,
    band: healthBand(score),
    parts: {
      savings: { points: savingsPoints, max: 40, ratePercent },
      reserve: { points: reservePoints, max: 30, months },
      onTime: { points: onTimePoints, max: 30, overdue },
    },
  };
}
