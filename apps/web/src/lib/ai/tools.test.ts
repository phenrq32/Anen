import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { ToolContext } from "./tools";
import { runTool, toolDeclarationsFor } from "./tools";

// Sessão mínima: a recusa por contexto acontece antes de qualquer consulta à base de dados.
const ctx = (active: boolean) =>
  ({ session: { active: active ? { organization: { id: "0b7c6a4e-1111-4c1e-9b8a-2f1d3c4b5a69", name: "Obras Lda" } } : null }, m: {}, locale: "pt-PT" }) as unknown as ToolContext;

describe("ferramentas da ANEN AI por contexto (§8)", () => {
  it("o modelo só vê as ferramentas do contexto do espaço ativo", () => {
    expect(toolDeclarationsFor("PERSONAL_AI_CONTEXT").map((d) => d.name)).not.toContain("projetos");
    expect(toolDeclarationsFor("BUSINESS_AI_CONTEXT").map((d) => d.name)).toContain("projetos");
    expect(toolDeclarationsFor("BUSINESS_AI_CONTEXT").map((d) => d.name)).not.toContain("orcamento_e_objetivos");
  });

  it("uma ferramenta de empresa pedida no pessoal é recusada no servidor, sem consultar dados", async () => {
    const r = await runTool(ctx(false), "precos_fornecedores", {});
    expect(r.data).toEqual({ erro: "Esta informação não está disponível neste espaço." });
    expect(r.sources).toEqual([]);
    const b = await runTool(ctx(true), "orcamento_e_objetivos", {});
    expect(b.data).toEqual({ erro: "Esta informação não está disponível neste espaço." });
  });
});
