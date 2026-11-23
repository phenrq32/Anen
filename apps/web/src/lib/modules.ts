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
export function isHiddenHref(href: string, hidden: ReadonlySet<string>): boolean {
  const first = href.split(/[/?#]/).filter(Boolean)[0] ?? "";
  return hidden.has(first);
}

/**
 * Dual Workspace · Fase 4: módulos de empresa. No espaço pessoal saem do menu, exceto os que a pessoa já
 * usa com dados pessoais (para não esconder trabalho existente). As páginas continuam acessíveis.
 */
export const BUSINESS_MODULES = ["orcamentos", "faturacao", "projetos", "compras", "inventario", "restauracao", "mercado"] as const;
export type BusinessModule = (typeof BUSINESS_MODULES)[number];

/** Permissão de leitura de cada área numa organização (sem ela, a área sai do menu). */
const READ_PERMISSION: Record<string, string> = {
  financas: "finance.read",
  faturacao: "finance.read",
  relatorios: "finance.read",
  contactos: "business.read",
  projetos: "business.read",
  compras: "business.read",
  inventario: "business.read",
  mercado: "business.read",
  orcamentos: "quotes.read",
  restauracao: "quotes.read",
};

/** Áreas a tirar do menu por causa do workspace ativo (o tipo, as permissões e o que a pessoa já usa). */
export function contextHiddenModules(input: {
  type: "PERSONAL" | "BUSINESS";
  /** Permissões da função na organização ativa (só BUSINESS). */
  permissions?: ReadonlySet<string>;
  /** Módulos de empresa com dados pessoais (só PERSONAL). */
  personalUsage?: ReadonlySet<string>;
}): Set<string> {
  if (input.type === "PERSONAL") {
    return new Set(BUSINESS_MODULES.filter((k) => !(input.personalUsage ?? new Set()).has(k)));
  }
  const perms = input.permissions ?? new Set<string>();
  return new Set(Object.entries(READ_PERMISSION).filter(([, p]) => !perms.has(p)).map(([k]) => k));
}
