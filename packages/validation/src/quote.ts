import { z } from "zod";
import { parseAmountInput } from "./amount";

/** Quantidade decimal escrita pelo utilizador ("2,5", "90", "0.125") → "2.5"; null se inválida. */
export function parseQuantityInput(input: string, maxDecimals = 3): string | null {
  const v = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!new RegExp(`^\\d{1,10}(\\.\\d{1,${maxDecimals}})?$`).test(v)) return null;
  return v.replace(/^0+(?=\d)/, "");
}

/** Percentagem 0–100 com até 3 casas ("23", "6,5"). */
export function parsePercentInput(input: string, { max = 100, exclusiveMax = false } = {}): string | null {
  const v = parseQuantityInput(input || "0", 3);
  if (v === null) return null;
  const n = Number(v);
  if (n < 0 || n > max || (exclusiveMax && n >= max)) return null;
  return v;
}

export const QUOTE_ITEM_KINDS = ["material", "labor", "travel", "equipment", "overhead", "other"] as const;
export const QUOTE_ITEM_NATURES = ["product", "service"] as const;
export const QUOTE_DISCOUNT_TYPES = ["none", "percent", "amount"] as const;

export const quoteLineInputSchema = z.object({
  kind: z.enum(QUOTE_ITEM_KINDS),
  nature: z.enum(QUOTE_ITEM_NATURES),
  description: z.string().trim().min(1, { message: "description_required" }).max(300, { message: "too_long" }),
  quantity: z.string().max(20),
  unit: z.string().trim().max(20).optional().default(""),
  unitCost: z.string().max(32),
});

export const quoteHeaderSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, { message: "description_required" }).max(160, { message: "too_long" }),
  description: z.string().trim().max(4000, { message: "too_long" }),
  clientContactId: z.union([z.uuid({ message: "contact_invalid" }), z.literal("")]),
  clientName: z.string().trim().max(160, { message: "too_long" }),
  clientEmail: z.union([z.literal(""), z.email({ message: "email_invalid" })]),
  clientTaxId: z.string().trim().max(32, { message: "too_long" }),
  clientAddress: z.string().trim().max(400, { message: "too_long" }),
  validUntil: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_invalid" })]),
  margin: z.string().max(10),
  taxRate: z.string().max(10),
  taxLabel: z.string().trim().max(60, { message: "too_long" }),
  discountType: z.enum(QUOTE_DISCOUNT_TYPES, { message: "generic" }),
  discountValue: z.string().trim().max(32),
  conditions: z.string().trim().max(4000, { message: "too_long" }),
});

export interface ParsedQuoteLine {
  kind: (typeof QUOTE_ITEM_KINDS)[number];
  nature: (typeof QUOTE_ITEM_NATURES)[number];
  description: string;
  quantity: string;
  unit: string;
  unitCostMinor: bigint;
}

/** Valida e converte as linhas de um orçamento; devolve erros por índice. */
export function parseQuoteLines(
  raw: unknown,
  minorUnit: number,
): { lines: ParsedQuoteLine[]; errors: Record<number, string> } | null {
  const parsed = z.array(quoteLineInputSchema).max(200).safeParse(raw);
  if (!parsed.success) return null;
  const errors: Record<number, string> = {};
  const lines = parsed.data.map((l, i) => {
    const quantity = parseQuantityInput(l.quantity);
    const unitCost = parseAmountInput(l.unitCost || "0", minorUnit);
    if (quantity === null) errors[i] = "quantity_invalid";
    else if (unitCost === null) errors[i] = "amount_invalid";
    return { kind: l.kind, nature: l.nature, description: l.description, quantity: quantity ?? "0", unit: l.unit, unitCostMinor: unitCost ?? 0n };
  });
  return { lines, errors };
}

export type ParsedQuoteDiscount =
  | { type: "none" }
  | { type: "percent"; percent: string }
  | { type: "amount"; amountMinor: bigint };

/** Desconto escrito pelo utilizador: % (0–100, até 3 casas) ou valor na moeda do orçamento. Null se inválido. */
export function parseQuoteDiscount(type: (typeof QUOTE_DISCOUNT_TYPES)[number], value: string, minorUnit: number): ParsedQuoteDiscount | null {
  if (type === "none") return { type: "none" };
  if (type === "percent") {
    const percent = parsePercentInput(value);
    if (percent === null) return null;
    return Number(percent) === 0 ? { type: "none" } : { type: "percent", percent };
  }
  const amount = parseAmountInput(value || "0", minorUnit);
  if (amount === null || amount < 0n) return null;
  return amount === 0n ? { type: "none" } : { type: "amount", amountMinor: amount };
}
