import { describe, expect, it } from "vitest";
import { decimalToString } from "./decimal";
import { type PriceObservation, priceItemKey, summarizePriceHistory } from "./price-history";

let n = 0;
const obs = (itemName: string, price: bigint, observedOn: string, extra: Partial<PriceObservation> = {}): PriceObservation => ({
  id: String(++n),
  itemName,
  unit: "saco",
  unitPriceMinor: price,
  currency: "EUR",
  observedOn,
  createdAt: `${observedOn}T10:00:00Z`,
  ...extra,
});

describe("histórico de preços por fornecedor", () => {
  it("agrupa pelo nome normalizado e calcula a variação face ao preço anterior", () => {
    const [s] = summarizePriceHistory([
      obs("Cimento 25 kg", 600n, "2026-09-01"),
      obs("cimento  25 KG", 650n, "2026-11-01"),
      obs(" Cimento 25 kg", 620n, "2026-10-01"),
    ]);
    expect(s!.points.map((p) => p.observedOn)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(s!.latest.amountMinor).toBe(650n);
    expect(s!.previous!.amountMinor).toBe(620n);
    expect(s!.change!.amountMinor).toBe(30n);
    expect(decimalToString(s!.changePercent!)).toBe("4.8");
    expect(s!.min.amountMinor).toBe(600n);
    expect(s!.max.amountMinor).toBe(650n);
    expect(s!.itemName).toBe("cimento 25 KG");
  });

  it("não mistura unidades nem moedas", () => {
    const series = summarizePriceHistory([
      obs("Areia", 100n, "2026-11-01", { unit: "kg" }),
      obs("Areia", 4000n, "2026-11-02", { unit: "m3" }),
      obs("Areia", 500n, "2026-11-03", { unit: "kg", currency: "BRL" }),
    ]);
    expect(series).toHaveLength(3);
    expect(priceItemKey("Areia", "KG", "EUR")).toBe(priceItemKey(" areia ", "kg", "EUR"));
    expect(priceItemKey("Areia", "kg", "EUR")).not.toBe(priceItemKey("Areia", "kg", "BRL"));
  });

  it("descida, preço único, anterior a zero e desempate no mesmo dia", () => {
    const [down] = summarizePriceHistory([obs("Tinta", 2000n, "2026-10-01"), obs("Tinta", 1800n, "2026-11-01")]);
    expect(down!.change!.amountMinor).toBe(-200n);
    expect(decimalToString(down!.changePercent!)).toBe("-10.0");

    const [single] = summarizePriceHistory([obs("Lixa", 50n, "2026-11-01")]);
    expect(single!.previous).toBeNull();
    expect(single!.changePercent).toBeNull();

    const [zero] = summarizePriceHistory([obs("Brinde", 0n, "2026-10-01"), obs("Brinde", 100n, "2026-11-01")]);
    expect(zero!.change!.amountMinor).toBe(100n);
    expect(zero!.changePercent).toBeNull();

    const [sameDay] = summarizePriceHistory([
      obs("Cola", 300n, "2026-11-01", { createdAt: "2026-11-01T15:00:00Z" }),
      obs("Cola", 250n, "2026-11-01", { createdAt: "2026-11-01T09:00:00Z" }),
    ]);
    expect(sameDay!.latest.amountMinor).toBe(300n);
  });

  it("ordena os artigos pelo registo mais recente", () => {
    const series = summarizePriceHistory([obs("A", 1n, "2026-01-01"), obs("B", 1n, "2026-03-01"), obs("C", 1n, "2026-02-01")]);
    expect(series.map((s) => s.itemName)).toEqual(["B", "C", "A"]);
  });
});
