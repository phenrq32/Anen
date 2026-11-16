import { z } from "zod";

const uuid = z.uuid({ message: "generic" });
export const optionalUuid = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: "too_long" })
    .optional()
    .transform((v) => (v ? v : null));
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_invalid" })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
    message: "date_invalid",
  });
export const optionalDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const ACCOUNT_KINDS = ["checking", "savings", "cash", "credit_card", "investment", "other"] as const;
export const TRANSACTION_KINDS = ["income", "expense"] as const;
export const FREQUENCIES = ["weekly", "monthly", "yearly"] as const;
export const COST_KINDS = ["material", "labor", "travel", "equipment", "overhead", "other"] as const;
export const SETTLEMENTS = ["paid", "pending", "partial"] as const;
export const PAYMENT_METHODS = ["transfer", "card", "cash", "direct_debit", "mbway", "pix", "boleto", "check", "other"] as const;

/** Valores monetários chegam como texto e são convertidos com parseAmountInput na ação. */
const amountText = z.string().trim().min(1, { message: "amount_invalid" }).max(32, { message: "amount_invalid" });

export const accountSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, { message: "name_required" }).max(80, { message: "too_long" }),
  kind: z.enum(ACCOUNT_KINDS, { message: "generic" }),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" }),
  openingBalance: z.string().trim().max(32).optional().transform((v) => v || "0"),
});

export const transactionSchema = z.object({
  id: optionalUuid,
  kind: z.enum(TRANSACTION_KINDS, { message: "generic" }),
  amount: amountText,
  occurredOn: isoDate,
  accountId: uuid,
  categoryId: optionalUuid,
  description: z.string().trim().min(1, { message: "description_required" }).max(200, { message: "too_long" }),
  counterparty: optionalText(120),
  notes: optionalText(1000),
  // Ligações e detalhes (opcionais; o registo rápido não os envia)
  contactId: optionalUuid,
  projectId: optionalUuid,
  costCenterId: optionalUuid,
  costKind: z
    .union([z.enum(COST_KINDS), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  dueOn: optionalDate,
  /** Imposto incluído no valor (texto; convertido na ação). Vazio = sem separação. */
  tax: z.string().trim().max(32).optional().transform((v) => (v ? v : null)),
  /** paid (omissão), pending ou partial (com o valor já liquidado em `settled`). */
  settlement: z
    .union([z.enum(SETTLEMENTS), z.literal("")])
    .optional()
    .transform((v) => (v ? v : "paid")),
  settled: z.string().trim().max(32).optional().transform((v) => (v ? v : null)),
  paymentMethod: z
    .union([z.enum(PAYMENT_METHODS), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  documentRef: optionalText(120),
});

export const recurringSchema = z
  .object({
    kind: z.enum(TRANSACTION_KINDS, { message: "generic" }),
    amount: amountText,
    accountId: uuid,
    categoryId: optionalUuid,
    description: z.string().trim().min(1, { message: "description_required" }).max(200, { message: "too_long" }),
    frequency: z.enum(FREQUENCIES, { message: "generic" }),
    intervalCount: z.coerce.number().int().min(1).max(12),
    startOn: isoDate,
    endOn: optionalDate,
  })
  .refine((v) => !v.endOn || v.endOn >= v.startOn, { message: "date_invalid", path: ["endOn"] });

export const budgetSchema = z.object({
  categoryId: uuid,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "date_invalid" }),
  amount: amountText,
  currencyCode: z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" }),
});

export const goalSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, { message: "name_required" }).max(80, { message: "too_long" }),
  target: amountText,
  saved: z.string().trim().max(32).optional().transform((v) => v || "0"),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" }),
  targetDate: optionalDate,
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, { message: "name_required" }).max(60, { message: "too_long" }),
  kind: z.enum(TRANSACTION_KINDS, { message: "generic" }),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: "generic" }),
});

export const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();
