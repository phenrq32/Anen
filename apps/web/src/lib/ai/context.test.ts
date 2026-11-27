import { describe, expect, it } from "vitest";
import { AI_CONTEXT_TOOLS, aiContextFor, toolAllowed } from "./context";

describe("contexto da ANEN AI por espaço (§8)", () => {
  it("o espaço ativo decide o contexto", () => {
    expect(aiContextFor(null)).toBe("PERSONAL_AI_CONTEXT");
    expect(aiContextFor("0b7c6a4e-1111-4c1e-9b8a-2f1d3c4b5a69")).toBe("BUSINESS_AI_CONTEXT");
  });

  it("no pessoal não há ferramentas de empresa; na empresa não há a de objetivos pessoais", () => {
    for (const t of ["projetos", "precos_fornecedores", "estoque_reposicao", "orcamentos"]) expect(toolAllowed("PERSONAL_AI_CONTEXT", t)).toBe(false);
    expect(toolAllowed("BUSINESS_AI_CONTEXT", "orcamento_e_objetivos")).toBe(false);
    expect(toolAllowed("PERSONAL_AI_CONTEXT", "resumo_financeiro")).toBe(true);
    expect(toolAllowed("BUSINESS_AI_CONTEXT", "inventada")).toBe(false);
  });

  it("as listas não se sobrepõem no que é específico de cada espaço", () => {
    const personal = new Set<string>(AI_CONTEXT_TOOLS.PERSONAL_AI_CONTEXT);
    const onlyBusiness = AI_CONTEXT_TOOLS.BUSINESS_AI_CONTEXT.filter((t) => !personal.has(t));
    expect(onlyBusiness).toEqual(["projetos", "precos_fornecedores", "estoque_reposicao", "orcamentos"]);
  });
});
