import "server-only";
import type { Messages } from "@anen/i18n";
import type { FiscalDocument, InvoicingConnection } from "@anen/types";
import { financeScope, type FinanceScope } from "@/lib/finance";
import type { SessionContext } from "@/lib/session";
import { decryptSecret, encryptionConfigured } from "./crypto";
import { InvoiceXpress, InvoicingError, toMinor, type IxDocument } from "./invoicexpress";

export interface InvoicingContext {
  fin: FinanceScope;
  connection: InvoicingConnection | null;
}

export async function loadInvoicing(session: SessionContext): Promise<InvoicingContext> {
  const fin = financeScope(session);
  if (!fin.canRead) return { fin, connection: null };
  const { data } = await session.supabase.from("invoicing_connections").select("*").eq(fin.column, fin.value).maybeSingle();
  return { fin, connection: data ?? null };
}

export function clientFor(connection: InvoicingConnection): InvoiceXpress {
  if (!encryptionConfigured()) throw new InvoicingError("unavailable", "Cifra não configurada");
  return new InvoiceXpress(connection.account_name, decryptSecret(connection.api_key_ciphertext));
}

/** Mensagem traduzida para um erro do InvoiceXpress (o texto original vai junto quando ajuda a corrigir). */
export function invoicingErrorMessage(m: Messages, e: unknown): string {
  if (e instanceof InvoicingError) {
    const t = m.invoicing.errors;
    switch (e.code) {
      case "auth":
        return t.auth;
      case "not_found":
        return t.notFound;
      case "rate_limit":
        return t.rateLimit;
      case "unavailable":
        return t.unavailable;
      case "email_disabled":
        return t.emailDisabled;
      default:
        return `${t.invalid} ${e.message}`.trim();
    }
  }
  return m.errors.generic;
}

/** Campos fiscais devolvidos pelo InvoiceXpress, prontos para gravar na cópia local. */
export type FiscalFields = Pick<
  FiscalDocument,
  "status" | "sequence_number" | "atcud" | "saft_hash" | "permalink" | "at_doc_code" | "before_taxes_minor" | "taxes_minor" | "total_minor"
>;

export function fiscalFields(doc: IxDocument, kind: FiscalDocument["kind"]): FiscalFields {
  const status: FiscalDocument["status"] =
    doc.status === "settled" ? "settled" : doc.status === "canceled" ? "canceled" : doc.status === "draft" ? "draft" : "final";
  const n = (v: bigint | null) => (v === null ? null : Number(v));
  return {
    status: kind === "invoice_receipt" && status === "final" ? "settled" : status,
    sequence_number: doc.sequence_number ?? null,
    atcud: doc.atcud ?? null,
    saft_hash: doc.saft_hash ?? null,
    permalink: doc.permalink && /^https:\/\//.test(doc.permalink) ? doc.permalink : null,
    at_doc_code: doc.at_doc_code_id ?? null,
    before_taxes_minor: n(toMinor(doc.before_taxes)),
    taxes_minor: n(toMinor(doc.taxes)),
    total_minor: n(toMinor(doc.total)),
  };
}
