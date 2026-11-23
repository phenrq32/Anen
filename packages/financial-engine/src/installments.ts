/**
 * Parcelas mensais com fim (compras parceladas, prestações, contratos com prazo).
 *
 * Regras (prompt Dual Workspace §5.6):
 * - Uma parcela por mês, no dia escolhido; se o dia não existir nesse mês (31 em fevereiro), usa o último dia.
 * - A primeira parcela é a primeira data com esse dia a partir da data de início.
 * - Fim por número de parcelas ou por data (inclusive): nunca há parcelas além do prazo.
 * - Valor por parcela, ou valor total dividido pelas parcelas com a diferença de cêntimos na última,
 *   para o total bater certo.
 *
 * A base de dados repete este cálculo em public.create_installment_plan; o teste de paridade em
 * packages/database/tests/installments.test.ts garante que os dois dão o mesmo resultado.
 */

export const MAX_INSTALLMENTS = 360;

export type InstallmentAmount = { totalMinor: bigint } | { perInstallmentMinor: bigint };
export type InstallmentEnd = { count: number } | { endOn: string };

export interface InstallmentInput {
  /** Data a partir da qual começa (YYYY-MM-DD). */
  startOn: string;
  /** Dia do mês do vencimento (1 a 31). */
  dueDay: number;
  amount: InstallmentAmount;
  end: InstallmentEnd;
}

export interface Installment {
  /** 1, 2, …, n */
  number: number;
  /** Vencimento (YYYY-MM-DD). */
  dueOn: string;
  amountMinor: bigint;
}

export type InstallmentError = "installment_date_invalid" | "installment_day_invalid" | "installment_count_invalid" | "installment_amount_invalid";

export type InstallmentResult = { ok: true; installments: Installment[]; totalMinor: bigint } | { ok: false; error: InstallmentError };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(s: string): { y: number; m: number; d: number } | null {
  const match = ISO.exec(s);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Dias do mês (m de 1 a 12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Vencimento no mês (y, m) com o dia pedido, limitado ao último dia do mês. */
export function dueDateIn(y: number, m: number, dueDay: number): string {
  return iso(y, m, Math.min(dueDay, daysInMonth(y, m)));
}

/** Calendário das parcelas. Não usa números de vírgula flutuante para dinheiro. */
export function installmentSchedule(input: InstallmentInput): InstallmentResult {
  const start = parseIso(input.startOn);
  if (!start) return { ok: false, error: "installment_date_invalid" };
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) return { ok: false, error: "installment_day_invalid" };

  // Primeiro mês: o do início, ou o seguinte se o vencimento desse mês já passou.
  let y = start.y;
  let m = start.m;
  if (dueDateIn(y, m, input.dueDay) < input.startOn) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const dates: string[] = [];
  if ("count" in input.end) {
    const n = input.end.count;
    if (!Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS) return { ok: false, error: "installment_count_invalid" };
    for (let i = 0; i < n; i++) {
      dates.push(dueDateIn(y, m, input.dueDay));
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    if (!parseIso(input.end.endOn)) return { ok: false, error: "installment_date_invalid" };
    for (;;) {
      const d = dueDateIn(y, m, input.dueDay);
      if (d > input.end.endOn) break;
      dates.push(d);
      if (dates.length > MAX_INSTALLMENTS) return { ok: false, error: "installment_count_invalid" };
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    if (dates.length === 0) return { ok: false, error: "installment_count_invalid" };
  }

  const n = BigInt(dates.length);
  let amounts: bigint[];
  if ("totalMinor" in input.amount) {
    const total = input.amount.totalMinor;
    const base = total / n; // divisão inteira (bigint)
    if (total <= 0n || base < 1n) return { ok: false, error: "installment_amount_invalid" };
    amounts = dates.map((_, i) => (i === dates.length - 1 ? total - base * (n - 1n) : base));
  } else {
    const per = input.amount.perInstallmentMinor;
    if (per <= 0n) return { ok: false, error: "installment_amount_invalid" };
    amounts = dates.map(() => per);
  }
  const installments = dates.map((dueOn, i) => ({ number: i + 1, dueOn, amountMinor: amounts[i]! }));
  return { ok: true, installments, totalMinor: amounts.reduce((a, b) => a + b, 0n) };
}

/** Situação de um plano: parcelas pagas, por pagar e valor em dívida (a partir das parcelas existentes). */
export function installmentProgress(
  parcels: readonly { number: number; amountMinor: bigint; settledMinor: bigint }[],
  installmentCount: number,
): { paid: number; remaining: number; cancelled: number; outstandingMinor: bigint } {
  let paid = 0;
  let remaining = 0;
  let outstanding = 0n;
  for (const p of parcels) {
    if (p.settledMinor >= p.amountMinor) paid += 1;
    else {
      remaining += 1;
      outstanding += p.amountMinor - p.settledMinor;
    }
  }
  return { paid, remaining, cancelled: Math.max(0, installmentCount - parcels.length), outstandingMinor: outstanding };
}
