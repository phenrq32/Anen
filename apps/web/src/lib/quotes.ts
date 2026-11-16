import "server-only";
import { can, type SessionContext } from "@/lib/session";
import type { FinanceScope } from "@/lib/finance";

/** Âmbito de orçamentos/fichas técnicas (mesma forma do financeiro, permissões quotes.*). */
export function quotesScope(session: SessionContext): FinanceScope {
  if (session.active) {
    return {
      orgId: session.active.organization.id,
      ownerId: null,
      column: "organization_id",
      value: session.active.organization.id,
      canRead: can(session.active, "quotes.read"),
      canWrite: can(session.active, "quotes.write"),
      defaultCurrency: session.active.organization.currency_code,
      timezone: session.active.organization.timezone,
    };
  }
  return {
    orgId: null,
    ownerId: session.user.id,
    column: "owner_user_id",
    value: session.user.id,
    canRead: true,
    canWrite: true,
    defaultCurrency: session.preferences.currency_code,
    timezone: session.preferences.timezone,
  };
}

/** Converte numeric (number do PostgREST) em texto decimal para o motor (sem notação científica). */
export function numericToString(value: number, decimals = 3): string {
  return Number(value.toFixed(decimals)).toString();
}
