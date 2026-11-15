import { lookup, type Messages } from "@anen/i18n";

/**
 * Converte erros do Supabase (Auth, PostgREST, RPC) numa mensagem traduzida.
 * As funções SQL levantam exceções cuja mensagem é uma chave de messages.errors.
 * Detalhes técnicos nunca são mostrados ao utilizador.
 */
export function errorMessage(m: Messages, error: { message?: string; code?: string; status?: number } | null | undefined): string {
  if (!error) return m.errors.generic;
  const raw = (error.message ?? "").trim();
  const known = lookup(m.errors, raw);
  if (known) return known;
  if (error.code === "42501" || /permission denied/i.test(raw)) return m.errors.forbidden;
  if (error.status === 429 || /rate limit/i.test(raw)) return m.errors.rateLimited;
  return m.errors.generic;
}

/** Traduz um mapa campo → chave de validação. */
export function translateFieldErrors(m: Messages, fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, key] of Object.entries(fields)) {
    out[field] = lookup(m.errors, key) ?? m.errors.generic;
  }
  return out;
}

/** Nome traduzido de uma função de sistema; funções personalizadas usam o nome definido pela organização. */
export function roleName(m: Messages, role: { key: string; name: string; is_system: boolean }): string {
  return role.is_system ? (lookup(m.roles.names, role.key) ?? role.name) : role.name;
}
