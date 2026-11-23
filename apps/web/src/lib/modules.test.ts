import { describe, expect, it } from "vitest";
import { BUSINESS_MODULES, contextHiddenModules, isHiddenHref, parseHiddenModules } from "./modules";

describe("áreas do menu", () => {
  it("só aceita áreas conhecidas", () => {
    expect([...parseHiddenModules(["restauracao", "painel", "x"])]).toEqual(["restauracao"]);
    expect(parseHiddenModules(null).size).toBe(0);
  });
  it("reconhece a área pelo primeiro segmento do endereço", () => {
    const hidden = parseHiddenModules(["restauracao", "mercado"]);
    expect(isHiddenHref("/restauracao", hidden)).toBe(true);
    expect(isHiddenHref("/restauracao/abc?x=1", hidden)).toBe(true);
    expect(isHiddenHref("/mercado#topo", hidden)).toBe(true);
    expect(isHiddenHref("/orcamentos/novo", hidden)).toBe(false);
    expect(isHiddenHref("/painel", hidden)).toBe(false);
  });
});

describe("menu por workspace (Fase 4)", () => {
  it("no pessoal saem os módulos de empresa", () => {
    const hidden = contextHiddenModules({ type: "PERSONAL" });
    expect([...hidden].sort()).toEqual([...BUSINESS_MODULES].sort());
    for (const href of ["/compras", "/inventario/1", "/faturacao", "/orcamentos/novo", "/projetos", "/restauracao", "/mercado"]) {
      expect(isHiddenHref(href, hidden)).toBe(true);
    }
    for (const href of ["/painel", "/financas", "/financas/em-aberto", "/contactos", "/notificacoes", "/ia", "/relatorios", "/definicoes"]) {
      expect(isHiddenHref(href, hidden)).toBe(false);
    }
  });

  it("no pessoal ficam os módulos de empresa que a pessoa já usa (não se esconde trabalho existente)", () => {
    const hidden = contextHiddenModules({ type: "PERSONAL", personalUsage: new Set(["orcamentos", "projetos"]) });
    expect(hidden.has("orcamentos")).toBe(false);
    expect(hidden.has("projetos")).toBe(false);
    expect(hidden.has("compras")).toBe(true);
  });

  it("numa organização, cada área precisa da permissão de leitura", () => {
    const owner = new Set(["finance.read", "business.read", "quotes.read"]);
    expect(contextHiddenModules({ type: "BUSINESS", permissions: owner }).size).toBe(0);
    const onlyQuotes = contextHiddenModules({ type: "BUSINESS", permissions: new Set(["quotes.read"]) });
    expect(onlyQuotes.has("orcamentos")).toBe(false);
    expect(onlyQuotes.has("restauracao")).toBe(false);
    for (const k of ["financas", "faturacao", "relatorios", "contactos", "compras", "inventario", "projetos", "mercado"]) expect(onlyQuotes.has(k)).toBe(true);
    // Sem nenhuma permissão: só ficam as áreas da conta (painel, notificações, IA, definições…)
    const none = contextHiddenModules({ type: "BUSINESS", permissions: new Set() });
    expect(isHiddenHref("/painel", none)).toBe(false);
    expect(isHiddenHref("/notificacoes", none)).toBe(false);
    expect(isHiddenHref("/financas", none)).toBe(true);
  });
});
