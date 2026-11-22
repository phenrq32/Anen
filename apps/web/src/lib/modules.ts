/**
 * Áreas do menu que cada pessoa pode esconder (Definições → Áreas do menu; coluna user_preferences.hidden_modules).
 * A chave é o primeiro segmento do endereço. Painel, Finanças, Notificações, Contactos e as definições ficam sempre.
 */
export const OPTIONAL_MODULES = ["orcamentos", "faturacao", "projetos", "compras", "inventario", "restauracao", "ia", "inteligencia", "relatorios", "mercado"] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export function parseHiddenModules(v: readonly string[] | null | undefined): Set<OptionalModule> {
  return new Set(OPTIONAL_MODULES.filter((k) => (v ?? []).includes(k)));
}

/** O endereço pertence a uma área escondida? ("/restauracao/123" → restauracao). */
export function isHiddenHref(href: string, hidden: Set<OptionalModule>): boolean {
  const first = href.split(/[/?#]/).filter(Boolean)[0] ?? "";
  return (hidden as Set<string>).has(first);
}
