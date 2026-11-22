import { type Decimal, decimal, divideDecimal, rescale } from "./decimal";
import { marginPercent } from "./formulas";
import { moneyFromMinor, subtract, type Money } from "./money";

/**
 * Análises usadas pela ANEN AI. Todas determinísticas e testáveis: a IA só explica o resultado.
 * Dinheiro em unidades mínimas (bigint); moedas nunca se misturam.
 */

export interface ExpenseLike {
  id: string;
  description: string;
  amountMinor: bigint;
  currency: string;
  /** AAAA-MM-DD */
  occurredOn: string;
  contactId: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt").normalize("NFD").replace(/[̀-ͯ]/g, "");
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Despesas possivelmente duplicadas: mesmo valor e moeda, mesma descrição (ou o mesmo fornecedor)
 * e datas a até `windowDays` dias uma da outra. Devolve grupos com 2+ movimentos.
 */
export function findPossibleDuplicates(expenses: readonly ExpenseLike[], windowDays = 3): ExpenseLike[][] {
  const sorted = [...expenses].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const groups: ExpenseLike[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (used.has(a.id)) continue;
    const group = [a];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (dayNumber(b.occurredOn) - dayNumber(a.occurredOn) > windowDays) break;
      if (used.has(b.id) || b.amountMinor !== a.amountMinor || b.currency !== a.currency) continue;
      const sameWho = norm(b.description) === norm(a.description) || (a.contactId !== null && a.contactId === b.contactId);
      if (sameWho) group.push(b);
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.id));
      groups.push(group);
    }
  }
  return groups;
}

export interface CategoryTotal {
  key: string | null;
  totalMinor: bigint;
}

export interface CategoryChange {
  key: string | null;
  previous: Money;
  current: Money;
  change: Money;
  /** Variação em % (2 casas) ou null quando o período anterior é zero. */
  changePercent: Decimal | null;
}

/** Variação por categoria entre dois períodos, das maiores subidas para as maiores descidas. */
export function categoryChanges(previous: readonly CategoryTotal[], current: readonly CategoryTotal[], currency: string): CategoryChange[] {
  const keys = new Set([...previous, ...current].map((c) => c.key));
  const get = (list: readonly CategoryTotal[], key: string | null) => list.find((c) => c.key === key)?.totalMinor ?? 0n;
  return [...keys]
    .map((key) => {
      const p = moneyFromMinor(get(previous, key), currency);
      const c = moneyFromMinor(get(current, key), currency);
      const change = subtract(c, p);
      const changePercent =
        p.amountMinor === 0n ? null : rescale(divideDecimal(decimal(change.amountMinor * 100n), decimal(p.amountMinor), 4), 2);
      return { key, previous: p, current: c, change, changePercent };
    })
    .sort((a, b) => (a.change.amountMinor === b.change.amountMinor ? 0 : a.change.amountMinor > b.change.amountMinor ? -1 : 1));
}

export interface RequiredRevenue {
  /** Despesa média por mês no período usado como base. */
  averageMonthlyExpense: Money;
  /** Receita mensal necessária = despesa média + lucro pretendido. */
  requiredMonthlyRevenue: Money;
  /** Receita média atual por mês e quanto falta (0 quando já chega). */
  averageMonthlyIncome: Money;
  gap: Money;
  /** Margem que o lucro pretendido representa sobre a receita necessária. */
  targetMargin: Decimal | null;
}

/**
 * "Quanto preciso de faturar para ter X de lucro?": lucro = receita − despesa ⇒ receita = despesa + lucro.
 * Base: média mensal de receitas e despesas de `months` meses (arredondada à unidade mínima).
 */
export function requiredRevenue(input: {
  targetProfitMinor: bigint;
  totalExpenseMinor: bigint;
  totalIncomeMinor: bigint;
  months: number;
  currency: string;
}): RequiredRevenue {
  const months = BigInt(Math.max(1, Math.floor(input.months)));
  const avg = (v: bigint) => rescale(divideDecimal(decimal(v), decimal(months), 2), 0).coefficient;
  const expense = moneyFromMinor(avg(input.totalExpenseMinor), input.currency);
  const income = moneyFromMinor(avg(input.totalIncomeMinor), input.currency);
  const target = moneyFromMinor(input.targetProfitMinor, input.currency);
  const required = moneyFromMinor(expense.amountMinor + target.amountMinor, input.currency);
  const gapMinor = required.amountMinor - income.amountMinor;
  return {
    averageMonthlyExpense: expense,
    requiredMonthlyRevenue: required,
    averageMonthlyIncome: income,
    gap: moneyFromMinor(gapMinor > 0n ? gapMinor : 0n, input.currency),
    targetMargin: marginPercent(target, required),
  };
}
