import { describe, expect, it } from "vitest";
import { a11yDataAttributes, parseA11y, serializeA11y } from "./a11y";

describe("opções de acessibilidade", () => {
  it("lê e grava o cookie ignorando valores desconhecidos, na ordem fixa", () => {
    const s = parseA11y("links,xpto,motion");
    expect([...s].sort()).toEqual(["links", "motion"]);
    expect(serializeA11y(s)).toBe("motion,links");
    expect(parseA11y(undefined).size).toBe(0);
    expect(parseA11y(encodeURIComponent("contrast,font")).has("font")).toBe(true);
  });

  it("gera só os atributos das opções ligadas", () => {
    expect(a11yDataAttributes(parseA11y("motion,contrast"))).toEqual({ "data-motion": "reduce", "data-contrast": "high" });
    expect(a11yDataAttributes(new Set())).toEqual({});
  });
});
