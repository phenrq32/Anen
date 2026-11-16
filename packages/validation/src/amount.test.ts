import { describe, expect, it } from "vitest";
import { formatAmountInput, parseAmountInput, recurringSchema, transactionSchema } from "./index";

describe("parseAmountInput", () => {
  it.each([
    ["1234,56", 123456n],
    ["1.234,56", 123456n],
    ["1234.56", 123456n],
    ["1,234.56", 123456n],
    ["1 234,5", 123450n],
    ["1.234", 123400n], // milhares (pt)
    ["1.234.567", 123456700n],
    ["12,5", 1250n],
    ["0,05", 5n],
    [",5", 50n],
    ["€ 10", 1000n],
    ["R$ 1.500,00", 150000n],
    ["20", 2000n],
  ])("%s → %s", (input, expected) => {
    expect(parseAmountInput(input, 2)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "1.23.4", "12,345,6", "1,234,56", "10,005", "1e5", "--5", "9999999999999999999"])(
    "rejeita %s",
    (input) => {
      expect(parseAmountInput(input, 2)).toBeNull();
    },
  );

  it("negativos só quando permitidos", () => {
    expect(parseAmountInput("-20,5", 2)).toBeNull();
    expect(parseAmountInput("-20,5", 2, { allowNegative: true })).toBe(-2050n);
  });

  it("formata para edição", () => {
    expect(formatAmountInput(123456n, 2)).toBe("1234,56");
    expect(formatAmountInput(5n, 2, ".")).toBe("0.05");
    expect(formatAmountInput(-100n, 2)).toBe("-1,00");
  });
});

describe("esquemas financeiros", () => {
  const base = { kind: "expense", amount: "10", occurredOn: "2026-11-15", accountId: "4f1c8d0e-2b7a-4c55-9a51-8a0f6f2c1d3e", description: "Tinta" };

  it("valida datas reais", () => {
    expect(transactionSchema.safeParse(base).success).toBe(true);
    expect(transactionSchema.safeParse({ ...base, occurredOn: "2026-02-30" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, occurredOn: "15/11/2026" }).success).toBe(false);
  });

  it("recorrência: fim não pode ser antes do início", () => {
    const r = { ...base, frequency: "monthly", intervalCount: "1", startOn: "2026-11-01", endOn: "2026-10-01" };
    expect(recurringSchema.safeParse(r).success).toBe(false);
    expect(recurringSchema.safeParse({ ...r, endOn: "" }).success).toBe(true);
  });
});
