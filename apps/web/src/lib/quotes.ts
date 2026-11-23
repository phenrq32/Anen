import "server-only";
import type { SessionContext } from "@/lib/session";
import { workspaceScope } from "@/lib/workspace";
import type { FinanceScope } from "@/lib/finance";

/** Âmbito de orçamentos/fichas técnicas no workspace ativo (mesma forma do financeiro, permissões quotes.*). */
export function quotesScope(session: SessionContext): FinanceScope {
  return workspaceScope(session, { read: "quotes.read", write: "quotes.write" });
}

/** Converte numeric (number do PostgREST) em texto decimal para o motor (sem notação científica). */
export function numericToString(value: number, decimals = 3): string {
  return Number(value.toFixed(decimals)).toString();
}
