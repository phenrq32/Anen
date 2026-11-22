import { z } from "zod";
import { isoDate, optionalDate, optionalText, optionalUuid } from "./finance";
import { parseQuantityInput } from "./quote";
import { isValidPortugueseNif, normalizeTaxId } from "./tax-ids";

export const FISCAL_DOCUMENT_KINDS = ["invoice", "invoice_receipt", "simplified_invoice", "credit_note", "transport", "shipping"] as const;
export type FiscalDocumentKind = (typeof FISCAL_DOCUMENT_KINDS)[number];
/** Tipos que se criam pelo formulário (a nota de crédito nasce a partir de uma fatura). */
export const NEW_FISCAL_KINDS = ["invoice", "invoice_receipt", "simplified_invoice", "transport", "shipping"] as const;
export const isGuideKind = (k: string) => k === "transport" || k === "shipping";

/**
 * Motivos de isenção de IVA aceites pelo InvoiceXpress (tabela de códigos da AT; referências legais tal como
 * aparecem na documentação do InvoiceXpress). Obrigatório quando há linhas com IVA 0 %.
 */
export const TAX_EXEMPTION_CODES = ["M01", "M02", "M04", "M05", "M06", "M07", "M10", "M16", "M19", "M20", "M99"] as const;

export const invoicingConnectionSchema = z.object({
  accountName: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, { message: "invoicing_account_invalid" }),
  apiKey: z.string().trim().min(10, { message: "invoicing_key_invalid" }).max(200, { message: "invoicing_key_invalid" }),
});

const line = z.object({
  name: z.string().trim().min(1, { message: "name_required" }).max(60, { message: "too_long" }),
  description: optionalText(200),
  quantity: z.string().max(20),
  unitPrice: z.string().trim().min(1, { message: "amount_invalid" }).max(32, { message: "amount_invalid" }),
  taxName: z.string().trim().max(40).optional().transform((v) => v || null),
  discount: z.string().max(10).optional().transform((v) => v || "0"),
  stockItemId: optionalUuid,
});

const address = z.object({
  detail: z.string().trim().min(1, { message: "address_required" }).max(200, { message: "too_long" }),
  city: z.string().trim().min(1, { message: "address_required" }).max(120, { message: "too_long" }),
  postalCode: z.string().trim().min(1, { message: "address_required" }).max(20, { message: "too_long" }),
  country: z.string().trim().min(1).max(60).default("Portugal"),
});

export const fiscalDocumentSchema = z
  .object({
    kind: z.enum(NEW_FISCAL_KINDS, { message: "generic" }),
    contactId: optionalUuid,
    clientName: z.string().trim().min(1, { message: "name_required" }).max(200, { message: "too_long" }),
    clientFiscalId: optionalText(30),
    clientEmail: z
      .union([z.email({ message: "email_invalid" }).max(254), z.literal("")])
      .optional()
      .transform((v) => v || null),
    clientAddress: optionalText(400),
    clientCity: optionalText(120),
    clientPostalCode: optionalText(20),
    clientCountry: z.string().trim().max(60).optional().transform((v) => v || "Portugal"),
    issueDate: isoDate,
    dueDate: optionalDate,
    reference: optionalText(120),
    observations: optionalText(2000),
    taxExemption: z
      .union([z.enum(TAX_EXEMPTION_CODES), z.literal("")])
      .optional()
      .transform((v) => v || null),
    projectId: optionalUuid,
    quoteId: optionalUuid,
    stockOut: z.boolean().default(false),
    lines: z.array(line).min(1, { message: "lines_required" }).max(100),
    // guias
    loadedAt: z.string().max(25).optional().transform((v) => v || null),
    licensePlate: optionalText(20),
    addressFrom: address.optional(),
    addressTo: address.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.clientFiscalId && (v.clientCountry ?? "Portugal").toLowerCase() === "portugal" && !isValidPortugueseNif(normalizeTaxId(v.clientFiscalId))) {
      ctx.addIssue({ code: "custom", message: "tax_id_invalid", path: ["clientFiscalId"] });
    }
    if (v.dueDate && v.dueDate < v.issueDate) ctx.addIssue({ code: "custom", message: "date_invalid", path: ["dueDate"] });
    v.lines.forEach((l, i) => {
      if (parseQuantityInput(l.quantity) === null || Number(parseQuantityInput(l.quantity)) <= 0) {
        ctx.addIssue({ code: "custom", message: "quantity_invalid", path: ["lines", i, "quantity"] });
      }
      const d = parseQuantityInput(l.discount);
      if (d === null || Number(d) > 100) ctx.addIssue({ code: "custom", message: "percent_invalid", path: ["lines", i, "discount"] });
    });
    if (isGuideKind(v.kind)) {
      if (!v.loadedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.loadedAt)) ctx.addIssue({ code: "custom", message: "date_invalid", path: ["loadedAt"] });
      if (!v.addressFrom) ctx.addIssue({ code: "custom", message: "address_required", path: ["addressFrom"] });
      if (!v.addressTo) ctx.addIssue({ code: "custom", message: "address_required", path: ["addressTo"] });
    }
  });
export type FiscalDocumentInput = z.infer<typeof fiscalDocumentSchema>;

export const cancelFiscalSchema = z.object({
  id: z.uuid({ message: "forbidden" }),
  reason: z.string().trim().min(3, { message: "cancel_reason_required" }).max(500, { message: "too_long" }),
});
