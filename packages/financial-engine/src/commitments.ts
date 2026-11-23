/**
 * Compromissos futuros (Fase 5, §5.5): ocorrências de movimentos recorrentes, custo mensal e anual
 * equivalente e previsão de saldo. Valores em unidades mínimas (bigint), sem vírgula flutuante.
 *
 * As ocorrências seguem a regra do servidor (public.materialize_recurring): a ocorrência k é
 * start_on + passo × k, com o dia limitado ao último dia do mês (31/jan + 1 mês = 28/fev).
 * O teste de paridade em packages/database/tests/commitments.test.ts compara com o Postgres.
 */
import { daysInMonth } from "./installments";

export type Frequency = "weekly" | "monthly" | "yearly";

export interface RecurringRule {
  startOn: string;
  frequency: Frequency;
  intervalCount: number;
  /** Ocorrências já geradas como movimentos (a próxima é a de índice occurrenceCount). */
  occurrenceCount: number;
  endOn: string | null;
}

function parts(iso: string): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Soma meses como o Postgres (date + interval 'n months'): mantém o dia, limitado ao fim do mês. */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(iso: string, days: number): string {
  const t = Date.UTC(...(parts(iso).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number])) + days * 86_400_000;
  const dt = new Date(t);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Data da ocorrência k (0 = início). */
export function occurrenceDate(rule: Pick<RecurringRule, "startOn" | "frequency" | "intervalCount">, k: number): string {
  if (rule.frequency === "weekly") return addDays(rule.startOn, 7 * rule.intervalCount * k);
  if (rule.frequency === "monthly") return addMonthsClamped(rule.startOn, rule.intervalCount * k);
  return addMonthsClamped(rule.startOn, 12 * rule.intervalCount * k);
}

/** Ocorrências ainda não geradas entre from e until (inclusive), sem passar do fim. Limite de 400. */
export function upcomingOccurrences(rule: RecurringRule, from: string, until: string): string[] {
  const out: string[] = [];
  for (let k = rule.occurrenceCount; k < rule.occurrenceCount + 400; k++) {
    const d = occurrenceDate(rule, k);
    if (d > until || (rule.endOn && d > rule.endOn)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Divisão inteira com arredondamento a meio para cima (valores não negativos). */
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (2n * den);
}

/** Custo mensal equivalente de um valor recorrente (semanal: × 52 ÷ 12). */
export function monthlyEquivalentMinor(amountMinor: bigint, frequency: Frequency, intervalCount: number): bigint {
  const n = BigInt(intervalCount);
  if (frequency === "monthly") return divRound(amountMinor, n);
  if (frequency === "weekly") return divRound(amountMinor * 52n, 12n * n);
  return divRound(amountMinor, 12n * n);
}

/** Custo anual equivalente. */
export function annualEquivalentMinor(amountMinor: bigint, frequency: Frequency, intervalCount: number): bigint {
  const n = BigInt(intervalCount);
  if (frequency === "monthly") return divRound(amountMinor * 12n, n);
  if (frequency === "weekly") return divRound(amountMinor * 52n, n);
  return divRound(amountMinor, n);
}

export interface ForecastItem {
  date: string;
  /** Positivo entra, negativo sai. */
  signedMinor: bigint;
}

export interface ForecastPoint {
  date: string;
  balanceMinor: bigint;
}

/**
 * Saldo previsto dia a dia, de today a until, a partir do saldo atual (só o já liquidado) e dos
 * valores previstos. Valores previstos com data anterior a hoje (em atraso) contam hoje: continuam
 * por pagar e não se assume que já foram pagos. Devolve só os dias com movimento, mais o fim.
 */
export function balanceForecast(
  currentBalanceMinor: bigint,
  today: string,
  until: string,
  items: readonly ForecastItem[],
): { points: ForecastPoint[]; endMinor: bigint; lowest: ForecastPoint } {
  const byDay = new Map<string, bigint>();
  for (const it of items) {
    const day = it.date < today ? today : it.date;
    if (day > until) continue;
    byDay.set(day, (byDay.get(day) ?? 0n) + it.signedMinor);
  }
  let balance = currentBalanceMinor;
  let lowest: ForecastPoint = { date: today, balanceMinor: balance };
  const points: ForecastPoint[] = [];
  for (const day of [...byDay.keys()].sort()) {
    balance += byDay.get(day)!;
    const p = { date: day, balanceMinor: balance };
    points.push(p);
    if (balance < lowest.balanceMinor) lowest = p;
  }
  if (points.at(-1)?.date !== until) points.push({ date: until, balanceMinor: balance });
  return { points, endMinor: balance, lowest };
}
