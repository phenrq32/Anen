import { describe, expect, it } from "vitest";
import { compoundPercent, decimalToString, readMarketSeries } from "./index";

const p = (period: string, changeMonth: string | null, value: string | null = null) => ({ period, value, changeMonth, changeYear: null });

describe("séries de mercado", () => {
  it("compõe taxas mensais sem ponto flutuante", () => {
    expect(decimalToString(compoundPercent(["1", "1"]))).toBe("2.01");
    // IPCA, farinhas, féculas e massas: agosto a outubro de 2026 (IBGE, tabela 7060)
    expect(decimalToString(compoundPercent(["-0.17", "0.01", "0.66"]))).toBe("0.50");
    expect(decimalToString(compoundPercent(["-0.3", "-0.1", "-0.1"]))).toBe("-0.50");
    expect(decimalToString(compoundPercent([]))).toBe("0.00");
  });

  it("lê o último valor, o anterior, o acumulado de 3 meses e o sentido", () => {
    const r = readMarketSeries([p("2026-10-01", "0.66"), p("2026-08-01", "-0.17"), p("2026-09-01", "0.01")])!;
    expect(r.latest.period).toBe("2026-10-01");
    expect(r.previous!.period).toBe("2026-09-01");
    expect(decimalToString(r.change3Months!)).toBe("0.50");
    expect(r.direction).toBe("up");
    expect(r.recent.map((x) => x.period)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("não acumula meses com falhas nem sem taxa; variações pequenas são estáveis", () => {
    expect(readMarketSeries([p("2026-06-01", "1"), p("2026-08-01", "1"), p("2026-09-01", "1")])!.change3Months).toBeNull();
    expect(readMarketSeries([p("2026-07-01", null), p("2026-08-01", "1"), p("2026-09-01", "1")])!.change3Months).toBeNull();
    expect(readMarketSeries([p("2026-09-01", "0.05")])!.direction).toBe("stable");
    expect(readMarketSeries([p("2026-09-01", "-0.1")])!.direction).toBe("down");
    expect(readMarketSeries([p("2026-09-01", null, "102.1")])!.direction).toBeNull();
    expect(readMarketSeries([])).toBeNull();
  });

  it("muda de ano corretamente", () => {
    const r = readMarketSeries([p("2025-11-01", "1"), p("2025-12-01", "1"), p("2026-01-01", "1")])!;
    expect(decimalToString(r.change3Months!)).toBe("3.03");
  });
});
