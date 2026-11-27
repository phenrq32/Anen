/**
 * Dual Workspace · Fase 6 (§6.1): números do "Hoje" de uma empresa, numa só moeda. Distingue o que já
 * aconteceu (saldo registado e resultado do período) do que está previsto (por receber e por pagar).
 * - Saldo de caixa registado: soma dos saldos das contas (dinheiro que existe hoje, segundo os registos).
 * - Resultado do período: receitas − despesas registadas no período (lucro ou prejuízo, regime de caixa).
 * - Margem: resultado ÷ receitas, em pontos-base (1 % = 100), arredondada; null sem receitas.
 * - Previsto: valores por receber e por pagar ainda em aberto; os que vencem até ao horizonte (ou já
 *   vencidos) entram no saldo previsto. Sem data de vencimento ficam fora do horizonte.
 */
export interface PulseOpenItem {
  kind: "income" | "expense";
  /** Valor ainda em aberto (total − já liquidado), em unidades mínimas. */
  remainingMinor: bigint;
  /** AAAA-MM-DD ou null. */
  dueOn: string | null;
}

export interface BusinessPulse {
  cashMinor: bigint;
  incomeMinor: bigint;
  expenseMinor: bigint;
  resultMinor: bigint;
  marginBasisPoints: bigint | null;
  receivableMinor: bigint;
  payableMinor: bigint;
  receivableDueMinor: bigint;
  payableDueMinor: bigint;
  overdueReceivables: number;
  overduePayables: number;
  /** Saldo registado + por receber até ao horizonte − por pagar até ao horizonte. */
  forecastMinor: bigint;
}

const roundDiv = (a: bigint, b: bigint) => {
  const neg = a < 0n !== b < 0n;
  const q = ((a < 0n ? -a : a) * 2n + (b < 0n ? -b : b)) / (2n * (b < 0n ? -b : b));
  return neg ? -q : q;
};

export function businessPulse(input: {
  cashMinor: bigint;
  incomeMinor: bigint;
  expenseMinor: bigint;
  open: readonly PulseOpenItem[];
  /** AAAA-MM-DD */
  today: string;
  /** AAAA-MM-DD: último dia incluído no saldo previsto. */
  horizon: string;
}): BusinessPulse {
  let receivableMinor = 0n;
  let payableMinor = 0n;
  let receivableDueMinor = 0n;
  let payableDueMinor = 0n;
  let overdueReceivables = 0;
  let overduePayables = 0;
  for (const o of input.open) {
    if (o.remainingMinor <= 0n) continue;
    const due = o.dueOn !== null && o.dueOn <= input.horizon;
    const overdue = o.dueOn !== null && o.dueOn < input.today;
    if (o.kind === "income") {
      receivableMinor += o.remainingMinor;
      if (due) receivableDueMinor += o.remainingMinor;
      if (overdue) overdueReceivables++;
    } else {
      payableMinor += o.remainingMinor;
      if (due) payableDueMinor += o.remainingMinor;
      if (overdue) overduePayables++;
    }
  }
  const resultMinor = input.incomeMinor - input.expenseMinor;
  return {
    cashMinor: input.cashMinor,
    incomeMinor: input.incomeMinor,
    expenseMinor: input.expenseMinor,
    resultMinor,
    marginBasisPoints: input.incomeMinor > 0n ? roundDiv(resultMinor * 10000n, input.incomeMinor) : null,
    receivableMinor,
    payableMinor,
    receivableDueMinor,
    payableDueMinor,
    overdueReceivables,
    overduePayables,
    forecastMinor: input.cashMinor + receivableDueMinor - payableDueMinor,
  };
}
