import "server-only";
import { lookup, type Messages } from "@anen/i18n";
import type { FinancialAccount, TransactionCategory } from "@anen/types";
import type { SessionContext } from "@/lib/session";
import { workspaceScope, type WorkspaceScope } from "@/lib/workspace";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * Âmbito financeiro do workspace ativo: a organização do contexto atual ou as finanças pessoais.
 * Determinado SEMPRE a partir da sessão no servidor; o cliente nunca escolhe o âmbito.
 */
export type FinanceScope = WorkspaceScope;

export function financeScope(session: SessionContext): FinanceScope {
  return workspaceScope(session, { read: "finance.read", write: "finance.write" });
}

/** Campos de âmbito para inserções. */
export function scopeFields(scope: FinanceScope): { organization_id: string | null; owner_user_id: string | null } {
  return { organization_id: scope.orgId, owner_user_id: scope.ownerId };
}

/** Data de hoje (YYYY-MM-DD) no fuso indicado. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function categoryLabel(m: Messages, category: Pick<TransactionCategory, "is_system" | "key" | "name"> | undefined): string {
  if (!category) return m.finance.tx.noCategory;
  return category.is_system && category.key ? (lookup(m.finance.category.names, category.key) ?? category.name) : category.name;
}

export interface FinanceBasics {
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  balances: Map<string, bigint>;
  minorUnits: Map<string, number>;
}

export async function loadFinanceBasics(supabase: ServerClient, scope: FinanceScope): Promise<FinanceBasics> {
  const [accounts, categories, balances, currencies] = await Promise.all([
    supabase.from("financial_accounts").select("*").eq(scope.column, scope.value).order("name"),
    supabase
      .from("transaction_categories")
      .select("*")
      .or(`is_system.eq.true,${scope.column}.eq.${scope.value}`)
      .is("archived_at", null)
      .order("is_system", { ascending: false })
      .order("name"),
    supabase.rpc("account_balances", { p_org: scope.orgId }),
    supabase.from("currencies").select("code, minor_unit"),
  ]);
  if (accounts.error || categories.error || balances.error || currencies.error) {
    throw new Error("Falha ao carregar finanças");
  }
  return {
    accounts: accounts.data ?? [],
    categories: categories.data ?? [],
    balances: new Map((balances.data ?? []).map((b) => [b.account_id, BigInt(b.balance_minor)])),
    minorUnits: new Map((currencies.data ?? []).map((c) => [c.code, c.minor_unit])),
  };
}

/** Gera os movimentos recorrentes vencidos (só quem pode escrever; idempotente). */
export async function materializeDue(supabase: ServerClient, scope: FinanceScope): Promise<void> {
  if (!scope.canWrite) return;
  await supabase.rpc("materialize_recurring", { p_org: scope.orgId, p_until: todayIn(scope.timezone) });
}

/** Totais por moeda a partir de pares (moeda, valor). */
export function sumByCurrency(items: Iterable<{ currency: string; amount: bigint }>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const { currency, amount } of items) out.set(currency, (out.get(currency) ?? 0n) + amount);
  return out;
}

/** Número total de parcelas de cada plano presente nestes movimentos (para "Parcela 3 de 12"). */
export async function loadInstallmentCounts(
  supabase: ServerClient,
  scope: FinanceScope,
  transactions: readonly { installment_plan_id: string | null }[],
): Promise<Map<string, number>> {
  const ids = [...new Set(transactions.flatMap((t) => (t.installment_plan_id ? [t.installment_plan_id] : [])))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("installment_plans").select("id, installment_count").in("id", ids).eq(scope.column, scope.value);
  if (error) throw new Error("Falha ao carregar parcelas");
  return new Map((data ?? []).map((p) => [p.id, p.installment_count]));
}
