import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  compareDecimal,
  decimal,
  decimalToString,
  divideDecimal,
  divideRounded,
  grossProfit,
  marginPercent,
  markupPercent,
  money,
  multiply,
  operatingResult,
  percentOf,
  priceFromMargin,
  priceFromMarkup,
  rescale,
  subtract,
  sum,
  toDecimalString,
  totalCost,
} from "./index";

const eur = (v: string) => money(v, "EUR");
const brl = (v: string) => money(v, "BRL");
const pct = (d: ReturnType<typeof marginPercent>) => (d === null ? null : decimalToString(d));

describe("decimal", () => {
  it("lê e escreve sem perder precisão", () => {
    expect(decimalToString(decimal("0.1"))).toBe("0.1");
    expect(decimalToString(decimal("-12.050"))).toBe("-12.050");
    expect(decimalToString(decimal("0.005"))).toBe("0.005");
  });

  it("rejeita entradas inválidas", () => {
    expect(() => decimal("1,5")).toThrow();
    expect(() => decimal("abc")).toThrow();
    expect(() => decimal("1e5")).toThrow();
  });

  it("0.1 + 0.2 é exatamente 0.3", () => {
    const r = rescale({ coefficient: decimal("0.1").coefficient + decimal("0.2").coefficient, scale: 1 }, 1);
    expect(compareDecimal(r, decimal("0.3"))).toBe(0);
  });

  it.each([
    [5n, 2n, "half-up", 3n],
    [5n, 2n, "half-even", 2n],
    [7n, 2n, "half-even", 4n],
    [-5n, 2n, "half-up", -3n],
    [-5n, 2n, "half-even", -2n],
    [5n, 3n, "down", 1n],
    [4n, 3n, "up", 2n],
    [-4n, 3n, "up", -2n],
  ] as const)("divideRounded(%s, %s, %s) = %s", (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it("divide com casas pedidas", () => {
    expect(decimalToString(divideDecimal(decimal("10"), decimal("3"), 4))).toBe("3.3333");
    expect(decimalToString(divideDecimal(decimal("2"), decimal("3"), 2))).toBe("0.67");
  });
});

describe("money", () => {
  it("guarda unidades mínimas inteiras", () => {
    expect(eur("1234.5").amountMinor).toBe(123450n);
    expect(toDecimalString(eur("1234.5"))).toBe("1234.50");
    expect(toDecimalString(brl("-0.07"))).toBe("-0.07");
  });

  it("não arredonda silenciosamente valores introduzidos", () => {
    expect(() => eur("10.005")).toThrow(/casas decimais/);
    expect(eur("10.500").amountMinor).toBe(1050n);
  });

  it("não mistura moedas", () => {
    expect(() => add(eur("1"), brl("1"))).toThrow(/Moedas diferentes/);
  });

  it("rejeita moedas desconhecidas", () => {
    expect(() => money("1", "XYZ")).toThrow(/não suportada/);
  });

  it("multiplica por quantidades e taxas exatas", () => {
    expect(toDecimalString(multiply(eur("19.99"), "3"))).toBe("59.97");
    expect(toDecimalString(multiply(eur("10.00"), "0.125"))).toBe("1.25");
    expect(toDecimalString(multiply(eur("0.05"), "0.5"))).toBe("0.03"); // 2,5 cêntimos → half-up
    expect(toDecimalString(multiply(eur("0.05"), "0.5", "half-even"))).toBe("0.02");
  });

  it("calcula percentagens", () => {
    expect(toDecimalString(percentOf(eur("100"), "23"))).toBe("23.00");
    expect(toDecimalString(percentOf(eur("33.33"), "6"))).toBe("2.00");
    expect(toDecimalString(percentOf(brl("1000"), "2.5"))).toBe("25.00");
  });

  it("reparte sem perder cêntimos", () => {
    const parts = allocate(eur("100"), [1n, 1n, 1n]);
    expect(parts.map(toDecimalString)).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(parts, "EUR").amountMinor).toBe(10000n);

    const negative = allocate(eur("-0.05"), [1n, 1n]);
    expect(negative.map(toDecimalString)).toEqual(["-0.03", "-0.02"]);
  });
});

describe("fórmulas", () => {
  it("custo total = diretos + indiretos", () => {
    const total = totalCost([eur("300"), eur("200")], [eur("50.50")], "EUR");
    expect(toDecimalString(total)).toBe("550.50");
  });

  it("lucro bruto e resultado operacional", () => {
    expect(toDecimalString(grossProfit(eur("1000"), [eur("400"), eur("100")]))).toBe("500.00");
    expect(toDecimalString(operatingResult(eur("1000"), [eur("400"), eur("700")]))).toBe("-100.00");
  });

  it("distingue margem e markup", () => {
    const revenue = eur("125");
    const cost = eur("100");
    const profit = subtract(revenue, cost);
    expect(pct(marginPercent(profit, revenue))).toBe("20.00");
    expect(pct(markupPercent(profit, cost))).toBe("25.00");
  });

  it("margem indefinida quando a receita é zero", () => {
    expect(marginPercent(eur("0"), eur("0"))).toBeNull();
    expect(markupPercent(eur("10"), eur("0"))).toBeNull();
  });

  it("preço a partir de markup e de margem", () => {
    expect(toDecimalString(priceFromMarkup(eur("100"), "25"))).toBe("125.00");
    expect(toDecimalString(priceFromMargin(eur("100"), "20"))).toBe("125.00");
    expect(toDecimalString(priceFromMargin(eur("10"), "30"))).toBe("14.29");
    expect(() => priceFromMargin(eur("10"), "100")).toThrow();
  });

  it("margem com dízima arredonda com as casas pedidas", () => {
    expect(pct(marginPercent(eur("1"), eur("3"), 4))).toBe("33.3333");
  });
});
