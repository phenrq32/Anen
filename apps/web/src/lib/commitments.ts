import "server-only";
import { upcomingOccurrences } from "@anen/financial-engine";
import type { FinanceScope } from "@/lib/finance";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * Compromissos de um workspace num intervalo de datas (Fase 5, §5.5): valores por receber ou por pagar
 * (incluindo parcelas) e as ocorrências futuras dos recorrentes que ainda não foram geradas.
 * Tudo é previsto: nada aqui assume que já foi pago ou recebido.
 */
export interface Commitment {
  key: string;
  date: string;
  kind: "income" | "expense";
  description: string;
  /** Valor em falta (total menos o já liquidado). */
  amountMinor: bigint;
  currency: string;
  source: "pending" | "installment" | "recurring";
  installment?: { number: number; planId: string };
  overdue: boolean;
}

export async function loadCommitments(
  supabase: ServerClient,
  scope: FinanceScope,
  opts: { from: string; until: string; today: string; includeOverdue?: boolean },
): Promise<Commitment[]> {
  let pendingQuery = supabase
    .from("transactions")
    .select("id, kind, description, amount_minor, settled_minor, currency_code, due_on, occurred_on, installment_plan_id, installment_number")
    .eq(scope.column, scope.value)
    .in("payment_status", ["pending", "partial"])
    .limit(5000);
  // A data de um valor em aberto é o vencimento (ou a data do movimento, se não tiver vencimento).
  pendingQuery = opts.includeOverdue
    ? pendingQuery.or(`due_on.lte.${opts.until},and(due_on.is.null,occurred_on.lte.${opts.until})`)
    : pendingQuery.or(`and(due_on.gte.${opts.from},due_on.lte.${opts.until}),and(due_on.is.null,occurred_on.gte.${opts.from},occurred_on.lte.${opts.until})`);

  const [pendingRes, recurringRes] = await Promise.all([
    pendingQuery,
    supabase
      .from("recurring_transactions")
      .select("id, kind, description, amount_minor, currency_code, frequency, interval_count, start_on, end_on, occurrence_count")
      .eq(scope.column, scope.value)
      .eq("is_active", true)
      .limit(1000),
  ]);
  if (pendingRes.error || recurringRes.error) throw new Error("Falha ao carregar compromissos");

  const items: Commitment[] = [];
  for (const t of pendingRes.data ?? []) {
    const date = t.due_on ?? t.occurred_on;
    items.push({
      key: `tx:${t.id}`,
      date,
      kind: t.kind,
      description: t.description,
      amountMinor: BigInt(t.amount_minor) - BigInt(t.settled_minor),
      currency: t.currency_code,
      source: t.installment_plan_id ? "installment" : "pending",
      ...(t.installment_plan_id && t.installment_number ? { installment: { number: t.installment_number, planId: t.installment_plan_id } } : {}),
      overdue: date < opts.today,
    });
  }
  // Recorrentes: só as ocorrências que o servidor ainda não gerou (a partir de occurrence_count), e não no passado.
  const recurringFrom = opts.from > opts.today ? opts.from : opts.today;
  for (const r of recurringRes.data ?? []) {
    const dates = upcomingOccurrences(
      { startOn: r.start_on, frequency: r.frequency, intervalCount: r.interval_count, occurrenceCount: r.occurrence_count, endOn: r.end_on },
      recurringFrom,
      opts.until,
    );
    for (const d of dates) {
      items.push({
        key: `rec:${r.id}:${d}`,
        date: d,
        kind: r.kind,
        description: r.description,
        amountMinor: BigInt(r.amount_minor),
        currency: r.currency_code,
        source: "recurring",
        overdue: false,
      });
    }
  }
  return items.sort((a, b) => (a.date === b.date ? a.description.localeCompare(b.description) : a.date < b.date ? -1 : 1));
}
