import { z } from "zod";
import { isoDate, optionalDate, optionalText, optionalUuid } from "./finance";

export const CONTACT_KINDS = ["client", "supplier", "both"] as const;
export const PROJECT_STATUSES = ["planned", "active", "completed", "cancelled"] as const;

export const contactSchema = z.object({
  id: optionalUuid,
  kind: z.enum(CONTACT_KINDS, { message: "generic" }),
  name: z.string().trim().min(1, { message: "name_required" }).max(160, { message: "too_long" }),
  taxId: optionalText(32),
  email: z
    .union([z.email({ message: "email_invalid" }).max(254, { message: "too_long" }), z.literal("")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(40),
  address: optionalText(400),
  paymentTermsDays: z
    .union([z.coerce.number().int({ message: "number_invalid" }).min(0, { message: "number_invalid" }).max(365, { message: "number_invalid" }), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  notes: optionalText(2000),
});

export const projectSchema = z
  .object({
    id: optionalUuid,
    name: z.string().trim().min(1, { message: "name_required" }).max(160, { message: "too_long" }),
    clientContactId: optionalUuid,
    status: z.enum(PROJECT_STATUSES, { message: "generic" }),
    currencyCode: z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" }),
    plannedCost: z.string().trim().max(32).optional().transform((v) => v || "0"),
    plannedRevenue: z.string().trim().max(32).optional().transform((v) => v || "0"),
    startOn: optionalDate,
    endOn: optionalDate,
    notes: optionalText(2000),
  })
  .refine((v) => !v.startOn || !v.endOn || v.endOn >= v.startOn, { message: "date_invalid", path: ["endOn"] });

export const costCenterSchema = z.object({
  name: z.string().trim().min(1, { message: "name_required" }).max(80, { message: "too_long" }),
});

