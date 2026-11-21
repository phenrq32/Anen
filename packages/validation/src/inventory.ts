import { z } from "zod";
import { isoDate, optionalDate, optionalText, optionalUuid } from "./finance";
import { parseQuantityInput } from "./quote";

export const STOCK_MOVEMENT_KINDS = ["in", "out", "loss", "count"] as const;
export const PURCHASE_STATUSES = ["draft", "ordered", "received", "cancelled"] as const;

/** Quantidade obrigatória ("2,5" → "2.5"), até 3 casas. */
const quantity = (allowZero: boolean) =>
  z
    .string()
    .max(20, { message: "quantity_invalid" })
    .transform((v, ctx) => {
      const parsed = parseQuantityInput(v);
      if (parsed === null || (!allowZero && Number(parsed) === 0)) {
        ctx.addIssue({ code: "custom", message: "quantity_invalid" });
        return z.NEVER;
      }
      return parsed;
    });

/** Quantidade opcional (vazio = sem valor). */
const optionalQuantity = z
  .string()
  .max(20, { message: "quantity_invalid" })
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const parsed = parseQuantityInput(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "quantity_invalid" });
      return z.NEVER;
    }
    return parsed;
  });

const name = z.string().trim().min(1, { message: "name_required" }).max(160, { message: "too_long" });
const currencyCode = z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" });

export const stockItemSchema = z.object({
  id: optionalUuid,
  name,
  sku: optionalText(60),
  /** Obrigatória ao criar (a ação verifica); não muda depois. */
  unit: optionalText(20),
  currencyCode,
  minQuantity: optionalQuantity.transform((v) => v ?? "0"),
  targetQuantity: optionalQuantity,
  preferredSupplierId: optionalUuid,
  notes: optionalText(1000),
});

/** O custo (texto) é convertido para unidades mínimas no servidor com parseAmountInput; só nas entradas. */
export const stockMovementSchema = z
  .object({
    itemId: z.uuid({ message: "stock_item_invalid" }),
    kind: z.enum(STOCK_MOVEMENT_KINDS, { message: "generic" }),
    quantity: z.string().max(20, { message: "quantity_invalid" }),
    unitCost: z.string().trim().max(32, { message: "amount_invalid" }).optional().transform((v) => v ?? ""),
    occurredOn: isoDate,
    notes: optionalText(500),
  })
  .transform((v, ctx) => {
    const parsed = parseQuantityInput(v.quantity);
    if (parsed === null || (v.kind !== "count" && Number(parsed) === 0)) {
      ctx.addIssue({ code: "custom", message: "quantity_invalid", path: ["quantity"] });
      return z.NEVER;
    }
    if (v.kind === "in" && !v.unitCost) {
      ctx.addIssue({ code: "custom", message: "amount_invalid", path: ["unitCost"] });
      return z.NEVER;
    }
    return { ...v, quantity: parsed };
  });

export const purchaseOrderSchema = z
  .object({
    id: optionalUuid,
    supplierId: z.uuid({ message: "contact_invalid" }),
    currencyCode,
    projectId: optionalUuid,
    orderedOn: optionalDate,
    expectedOn: optionalDate,
    notes: optionalText(2000),
  })
  .refine((v) => !v.orderedOn || !v.expectedOn || v.expectedOn >= v.orderedOn, { message: "date_invalid", path: ["expectedOn"] });

export const purchaseLineSchema = z.object({
  orderId: z.uuid({ message: "forbidden" }),
  stockItemId: optionalUuid,
  description: optionalText(160),
  quantity: quantity(false),
  unit: optionalText(20),
  unitPrice: z.string().trim().min(1, { message: "amount_invalid" }).max(32, { message: "amount_invalid" }),
});

export const receivePurchaseSchema = z.object({
  orderId: z.uuid({ message: "forbidden" }),
  receivedOn: isoDate,
  accountId: optionalUuid,
  paid: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});
