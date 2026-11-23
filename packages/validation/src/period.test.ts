import { describe, expect, it } from "vitest";
import { periodDates, periodKind, periodRange } from "./period";

describe("períodos de movimentos", () => {
  it("dia, semana de segunda a domingo e mês civil", () => {
    expect(periodRange("day", "2026-11-23")).toEqual({ start: "2026-11-23", end: "2026-11-23" });
    expect(periodRange("week", "2026-11-23")).toEqual({ start: "2026-11-23", end: "2026-11-29" }); // segunda
    expect(periodRange("week", "2026-11-22")).toEqual({ start: "2026-11-16", end: "2026-11-22" }); // domingo
    expect(periodRange("month", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodRange("month", "2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodRange("week", "2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("a data do movimento é o fim do período, ou hoje se o período ainda está a decorrer", () => {
    expect(periodDates("week", "2026-11-18", "2026-11-25")).toEqual({ occurredOn: "2026-11-22", start: "2026-11-16", end: "2026-11-22" });
    expect(periodDates("week", "2026-11-24", "2026-11-25")).toEqual({ occurredOn: "2026-11-25", start: "2026-11-23", end: "2026-11-29" });
    expect(periodDates("month", "2026-11-05", "2026-11-25").occurredOn).toBe("2026-11-25");
    expect(periodDates("month", "2026-10-05", "2026-11-25").occurredOn).toBe("2026-10-31");
    // Período futuro (data de referência depois de hoje): fica no fim desse período.
    expect(periodDates("week", "2026-12-10", "2026-11-25").occurredOn).toBe("2026-12-13");
  });

  it("reconhece o tipo de um intervalo guardado", () => {
    expect(periodKind("2026-11-23", "2026-11-23")).toBe("day");
    expect(periodKind("2026-11-16", "2026-11-22")).toBe("week");
    expect(periodKind("2026-11-01", "2026-11-30")).toBe("month");
  });
});
