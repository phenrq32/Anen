import { type Decimal, divideDecimal } from "./decimal";
import { marginPercent } from "./formulas";
import { type Money, MoneyError, moneyFromMinor, percentOf, subtract, sum, zero } from "./money";

/**
 * Plano do mês: salário, despesas fixas e o que fazer com a sobra.
 *
 * Regras (regras práticas de educação financeira, explicadas na interface):
 * 1. Reserva de emergência alvo = 6 meses de despesas fixas (sem despesas fixas: 3 salários).
 * 2. A sobra vai primeiro para a reserva: 80 % enquanto cobre menos de 3 meses, 50 % entre 3 e 6
 *    meses, 0 % quando está completa. Nunca mais do que falta para o alvo.
 * 3. O resto vai para objetivos de longo prazo.
 * 4. Despesas fixas acima de 50 % do salário geram um aviso (referência da regra 50/30/20).
 * Nada aqui é uma taxa de rendimento: as projeções somam apenas o valor guardado.
 */
export interface MonthlyPlanInput {
  currency: string;
  salaryMinor: bigint;
  fixedExpensesMinor: readonly bigint[];
  /** Quanto a pessoa já tem guardado para emergências. */
  emergencyReserveMinor: bigint;
}

export type PlanStatus = "surplus" | "balanced" | "deficit";
/** Dimensão da sobra face ao salário, para adaptar a orientação ao valor. */
export type SurplusSize = "none" | "small" | "medium" | "large";

export interface MonthlyPlan {
  status: PlanStatus;
  salary: Money;
  fixedTotal: Money;
  /** Salário − despesas fixas (negativo em défice). */
  surplus: Money;
  fixedPercentOfSalary: Decimal | null;
  surplusPercentOfSalary: Decimal | null;
  fixedAboveHalf: boolean;
  surplusSize: SurplusSize;
  reserve: {
    current: Money;
    target: Money;
    gap: Money;
    /** Meses de despesas fixas já cobertos (1 casa decimal); null sem despesas fixas. */
    monthsCovered: Decimal | null;
    complete: boolean;
    /** Meses até completar a reserva ao ritmo sugerido; null se não aplicável. */
    monthsToTarget: number | null;
  };
  allocation: { reserve: Money; longTerm: Money };
  /** Quanto junta se guardar a sobra todos os meses, sem contar rendimentos. */
  projection: { months12: Money; months60: Money; months120: Money };
}

const RESERVE_MONTHS = 6n;
const SALARIES_WITHOUT_FIXED = 3n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function computeMonthlyPlan(input: MonthlyPlanInput): MonthlyPlan {
  const { currency } = input;
  if (input.salaryMinor < 0n || input.emergencyReserveMinor < 0n || input.fixedExpensesMinor.some((v) => v < 0n)) {
    throw new MoneyError("Valores negativos não são permitidos no plano");
  }
  const money = (v: bigint) => moneyFromMinor(v, currency);
  const salary = money(input.salaryMinor);
  const fixedTotal = sum(input.fixedExpensesMinor.map(money), currency);
  const surplus = subtract(salary, fixedTotal);
  const status: PlanStatus = surplus.amountMinor > 0n ? "surplus" : surplus.amountMinor === 0n ? "balanced" : "deficit";

  const fixedPercent = salary.amountMinor > 0n ? marginPercent(fixedTotal, salary) : null;
  const surplusPercent = salary.amountMinor > 0n ? marginPercent(surplus, salary) : null;

  // Reserva de emergência
  const current = money(input.emergencyReserveMinor);
  const target = money(fixedTotal.amountMinor > 0n ? fixedTotal.amountMinor * RESERVE_MONTHS : salary.amountMinor * SALARIES_WITHOUT_FIXED);
  const gapMinor = target.amountMinor > current.amountMinor ? target.amountMinor - current.amountMinor : 0n;
  const monthsCovered =
    fixedTotal.amountMinor > 0n ? divideDecimal({ coefficient: current.amountMinor, scale: 0 }, { coefficient: fixedTotal.amountMinor, scale: 0 }, 1, "down") : null;
  const complete = target.amountMinor > 0n && gapMinor === 0n;

  // Repartição da sobra
  let reserveAlloc = zero(currency);
  let longTerm = zero(currency);
  if (status === "surplus") {
    // Cobertura em meses medida por inteiros: < 3 meses → 80 %, < 6 → 50 %, completa → 0 %.
    const coveredTimes = fixedTotal.amountMinor > 0n ? current.amountMinor / fixedTotal.amountMinor : current.amountMinor >= target.amountMinor ? 6n : 0n;
    const share = complete ? "0" : coveredTimes < 3n ? "80" : "50";
    const suggested = percentOf(surplus, share, "down");
    reserveAlloc = money(suggested.amountMinor < gapMinor ? suggested.amountMinor : gapMinor);
    longTerm = subtract(surplus, reserveAlloc);
  }
  const monthsToTarget = reserveAlloc.amountMinor > 0n && gapMinor > 0n ? Number(ceilDiv(gapMinor, reserveAlloc.amountMinor)) : null;

  // Dimensão da sobra face ao salário (orientação adaptada ao valor)
  let surplusSize: SurplusSize = "none";
  if (status === "surplus" && salary.amountMinor > 0n) {
    const tenths = (surplus.amountMinor * 1000n) / salary.amountMinor; // permilagem
    surplusSize = tenths < 50n ? "small" : tenths < 200n ? "medium" : "large";
  }

  const monthly = status === "surplus" ? surplus.amountMinor : 0n;
  return {
    status,
    salary,
    fixedTotal,
    surplus,
    fixedPercentOfSalary: fixedPercent,
    surplusPercentOfSalary: surplusPercent,
    fixedAboveHalf: salary.amountMinor > 0n && fixedTotal.amountMinor * 2n > salary.amountMinor,
    surplusSize,
    reserve: { current, target, gap: money(gapMinor), monthsCovered, complete, monthsToTarget },
    allocation: { reserve: reserveAlloc, longTerm },
    projection: { months12: money(monthly * 12n), months60: money(monthly * 60n), months120: money(monthly * 120n) },
  };
}
