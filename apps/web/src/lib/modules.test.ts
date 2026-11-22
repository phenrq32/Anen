import { describe, expect, it } from "vitest";
import { isHiddenHref, parseHiddenModules } from "./modules";

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
