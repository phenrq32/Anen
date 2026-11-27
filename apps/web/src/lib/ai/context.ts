/**
 * Dual Workspace · Fase 8 (§8): a ANEN AI trabalha num de dois contextos independentes, o do espaço ativo.
 * - PERSONAL_AI_CONTEXT: só movimentos, contas, objetivos, orçamentos e compromissos pessoais.
 * - BUSINESS_AI_CONTEXT: movimentos da empresa, clientes, fornecedores, projetos, orçamentos, compras e stock.
 * Cada ferramenta lê só o espaço ativo (RLS + âmbito no servidor); esta lista decide que ferramentas existem
 * em cada contexto, e a execução recusa uma ferramenta fora da lista mesmo que o modelo a peça.
 */
export type AiContext = "PERSONAL_AI_CONTEXT" | "BUSINESS_AI_CONTEXT";

export const AI_CONTEXT_TOOLS = {
  PERSONAL_AI_CONTEXT: ["resumo_financeiro", "comparar_periodos", "pendentes", "despesas_duplicadas", "receita_necessaria", "orcamento_e_objetivos"],
  BUSINESS_AI_CONTEXT: [
    "resumo_financeiro",
    "comparar_periodos",
    "pendentes",
    "despesas_duplicadas",
    "receita_necessaria",
    "projetos",
    "precos_fornecedores",
    "estoque_reposicao",
    "orcamentos",
  ],
} as const satisfies Record<AiContext, readonly string[]>;

export function aiContextFor(activeOrganizationId: string | null): AiContext {
  return activeOrganizationId ? "BUSINESS_AI_CONTEXT" : "PERSONAL_AI_CONTEXT";
}

export function toolAllowed(context: AiContext, tool: string): boolean {
  return (AI_CONTEXT_TOOLS[context] as readonly string[]).includes(tool);
}
