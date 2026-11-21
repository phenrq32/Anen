import { describe, expect, it } from "vitest";
import { ingredientCost, money, toDecimalString, unitConversionFactor } from "./index";

describe("conversão de unidades", () => {
  it("converte dentro da mesma grandeza", () => {
    expect(unitConversionFactor("kg", "g")).toBe("1000");
    expect(unitConversionFactor("Kg.", " G ")).toBe("1000");
    expect(unitConversionFactor("L", "ml")).toBe("1000");
    expect(unitConversionFactor("l", "cl")).toBe("100");
    expect(unitConversionFactor("dúzia", "un")).toBe("12");
    expect(unitConversionFactor("g", "g")).toBe("1");
    expect(unitConversionFactor("kg", "kg")).toBe("1");
    expect(unitConversionFactor("g", "kg")).toBe("0.001");
  });

  it("não converte entre grandezas, unidades desconhecidas nem frações inexatas", () => {
    expect(unitConversionFactor("kg", "ml")).toBeNull();
    expect(unitConversionFactor("saco 25 kg", "g")).toBeNull();
    expect(unitConversionFactor(null, "g")).toBeNull();
    expect(unitConversionFactor("mg", "kg")).toBeNull(); // 0,000001: abaixo das 3 casas
    expect(unitConversionFactor("un", "dz")).toBeNull(); // 1/12 não é exato
  });

  it("um preço de 2,50 €/kg dá o custo certo a 200 g", () => {
    const factor = unitConversionFactor("kg", "g")!;
    const cost = ingredientCost({ quantity: "200", packageQuantity: factor, packagePriceMinor: money("2.50", "EUR").amountMinor, wastePercent: "0" }, "EUR");
    expect(toDecimalString(cost)).toBe("0.50");
  });
});
