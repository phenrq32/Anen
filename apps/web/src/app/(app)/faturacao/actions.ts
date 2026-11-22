"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { format } from "@anen/i18n";
import type { FiscalDocument, FiscalDocumentLine } from "@anen/types";
import {
  cancelFiscalSchema,
  fieldErrors,
  fiscalDocumentSchema,
  invoicingConnectionSchema,
  isGuideKind,
  parseAmountInput,
  parseQuantityInput,
} from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { scopeFields } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { encryptSecret, encryptionConfigured } from "@/lib/invoicing/crypto";
import { fromMinor, InvoiceXpress, InvoicingError, isGuide, ixDate, lisbonLocalToUtc, type IxDocumentInput, type IxItem } from "@/lib/invoicing/invoicexpress";
import { clientFor, fiscalFields, invoicingErrorMessage, loadInvoicing } from "@/lib/invoicing/service";
import { requireOnboardedSession } from "@/lib/session";

const UUID = /^[0-9a-f-]{36}$/;

function refresh(id?: string) {
  revalidatePath("/faturacao", "layout");
  if (id) revalidatePath(`/faturacao/${id}`);
}

async function ctx() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const inv = await loadInvoicing(session);
  return { m, session, ...inv };
}

// ---------------------------------------------------------------------------
// Ligação à conta InvoiceXpress
// ---------------------------------------------------------------------------
export async function connectInvoicingAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite) return { status: "error", message: m.errors.forbidden };
  if (!encryptionConfigured()) return { status: "error", message: m.invoicing.notConfigured };
  const parsed = invoicingConnectionSchema.safeParse({ accountName: formString(formData, "accountName"), apiKey: formString(formData, "apiKey") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { accountName, apiKey } = parsed.data;
  let taxes, sequences;
  try {
    const ix = new InvoiceXpress(accountName, apiKey);
    [taxes, sequences] = await Promise.all([ix.listTaxes(), ix.listSequences()]);
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  const fields = {
    account_name: accountName,
    api_key_ciphertext: encryptSecret(apiKey),
    api_key_hint: apiKey.slice(-4),
    taxes: taxes.map((t) => ({ name: t.name, value: String(t.value), default_tax: Number(t.default_tax) })),
    sequences: sequences.map((s) => ({ id: s.id, serie: s.serie, default_sequence: s.default_sequence })),
    verified_at: new Date().toISOString(),
  };
  const result = connection
    ? await session.supabase.from("invoicing_connections").update(fields).eq("id", connection.id).select("id")
    : await session.supabase.from("invoicing_connections").insert({ ...scopeFields(fin), ...fields }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  refresh();
  return { status: "success", message: m.invoicing.connected };
}

export async function saveLoadAddressAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const address = {
    detail: formString(formData, "detail").trim().slice(0, 200),
    city: formString(formData, "city").trim().slice(0, 120),
    postal_code: formString(formData, "postalCode").trim().slice(0, 20),
    country: formString(formData, "country").trim().slice(0, 60) || "Portugal",
  };
  if (!address.detail || !address.city || !address.postal_code) return { status: "error", message: m.errors.address_required };
  const { error } = await session.supabase.from("invoicing_connections").update({ load_address: address }).eq("id", connection.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success", message: m.invoicing.saved };
}

export async function refreshInvoicingSettingsAction(_: FormState): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  try {
    const ix = clientFor(connection);
    const [taxes, sequences] = await Promise.all([ix.listTaxes(), ix.listSequences()]);
    await session.supabase
      .from("invoicing_connections")
      .update({
        taxes: taxes.map((t) => ({ name: t.name, value: String(t.value), default_tax: Number(t.default_tax) })),
        sequences: sequences.map((s) => ({ id: s.id, serie: s.serie, default_sequence: s.default_sequence })),
        verified_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  refresh();
  return { status: "success", message: m.invoicing.saved };
}

export async function disconnectInvoicingAction(_: FormState): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("invoicing_connections").delete().eq("id", connection.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  refresh();
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------
/** Cria o documento como RASCUNHO no InvoiceXpress e guarda a cópia local. Sem valor fiscal até finalizar. */
export async function createFiscalDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite) return { status: "error", message: m.errors.forbidden };
  if (!connection) return { status: "error", message: m.errors.invoicing_not_connected };
  let raw: unknown;
  try {
    raw = JSON.parse(formString(formData, "payload"));
  } catch {
    return { status: "error", message: m.errors.generic };
  }
  const parsed = fiscalDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const fe = translateFieldErrors(m, fieldErrors(parsed.error));
    return { status: "error", message: Object.values(fe)[0] ?? m.errors.generic, fieldErrors: fe };
  }
  const v = parsed.data;
  const taxes = new Map(connection.taxes.map((t) => [t.name, t]));
  const lines = v.lines.map((l, i) => {
    const price = parseAmountInput(l.unitPrice, 2);
    const tax = l.taxName ? taxes.get(l.taxName) : connection.taxes.find((t) => t.default_tax === 1);
    return { l, i, price, tax, quantity: parseQuantityInput(l.quantity)!, discount: parseQuantityInput(l.discount) ?? "0" };
  });
  const badPrice = lines.find((x) => x.price === null);
  if (badPrice) return { status: "error", message: format(m.invoicing.lineError, { n: badPrice.i + 1, error: m.errors.amount_invalid }) };
  if (lines.some((x) => x.tax && Number(x.tax.value) === 0) && !v.taxExemption) {
    return { status: "error", message: m.errors.tax_exemption_required, fieldErrors: { taxExemption: m.errors.tax_exemption_required } };
  }

  const uid = randomUUID();
  const items: IxItem[] = lines.map((x) => ({
    name: x.l.name,
    ...(x.l.description ? { description: x.l.description } : {}),
    unit_price: fromMinor(x.price!),
    quantity: Number(x.quantity),
    ...(Number(x.discount) > 0 ? { discount: Number(x.discount) } : {}),
    ...(x.tax ? { tax: { name: x.tax.name } } : {}),
  }));
  const addr = (a: NonNullable<typeof v.addressFrom>) => ({ detail: a.detail, city: a.city, postal_code: a.postalCode, country: a.country });
  const input: IxDocumentInput = {
    date: ixDate(v.issueDate),
    ...(v.dueDate ? { due_date: ixDate(v.dueDate) } : {}),
    client: {
      name: v.clientName,
      ...(v.contactId ? { code: v.contactId.slice(0, 30) } : {}),
      ...(v.clientFiscalId ? { fiscal_id: v.clientFiscalId } : {}),
      ...(v.clientEmail ? { email: v.clientEmail } : {}),
      ...(v.clientAddress ? { address: v.clientAddress } : {}),
      ...(v.clientCity ? { city: v.clientCity } : {}),
      ...(v.clientPostalCode ? { postal_code: v.clientPostalCode } : {}),
      country: v.clientCountry,
    },
    items,
    ...(v.reference ? { reference: v.reference } : {}),
    ...(v.observations ? { observations: v.observations } : {}),
    ...(v.taxExemption ? { tax_exemption: v.taxExemption } : {}),
    proprietary_uid: uid,
    ...(isGuideKind(v.kind) && v.loadedAt && v.addressFrom && v.addressTo
      ? {
          loaded_at: `${ixDate(v.loadedAt.slice(0, 10))} ${v.loadedAt.slice(11, 16)}:00`,
          ...(v.licensePlate ? { license_plate: v.licensePlate } : {}),
          address_from: addr(v.addressFrom),
          address_to: addr(v.addressTo),
        }
      : {}),
  };

  let created;
  try {
    created = await clientFor(connection).create(v.kind, input);
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  const f = fiscalFields(created, v.kind);
  const { data, error } = await session.supabase
    .from("fiscal_documents")
    .insert({
      ...scopeFields(fin),
      connection_id: connection.id,
      kind: v.kind,
      status: "draft",
      provider_id: created.id,
      proprietary_uid: uid,
      permalink: f.permalink,
      contact_id: v.contactId,
      client_name: v.clientName,
      client_fiscal_id: v.clientFiscalId,
      client_email: v.clientEmail,
      client_address: v.clientAddress,
      client_city: v.clientCity,
      client_postal_code: v.clientPostalCode,
      client_country: v.clientCountry,
      quote_id: v.quoteId,
      project_id: v.projectId,
      issue_date: v.issueDate,
      due_date: v.dueDate,
      before_taxes_minor: f.before_taxes_minor,
      taxes_minor: f.taxes_minor,
      total_minor: f.total_minor,
      reference: v.reference,
      observations: v.observations,
      tax_exemption: v.taxExemption,
      loaded_at: v.loadedAt ? lisbonLocalToUtc(v.loadedAt).toISOString() : null,
      license_plate: v.licensePlate,
      address_from: v.addressFrom ? addr(v.addressFrom) : null,
      address_to: v.addressTo ? addr(v.addressTo) : null,
      stock_out: v.stockOut,
    })
    .select("id");
  const id = data?.[0]?.id;
  if (error || !id) return { status: "error", message: errorMessage(m, error) };
  const lineRows: Omit<FiscalDocumentLine, "id">[] = lines.map((x) => ({
    document_id: id,
    position: x.i,
    name: x.l.name,
    description: x.l.description,
    quantity: x.quantity,
    unit_price_minor: Number(x.price!),
    tax_name: x.tax?.name ?? null,
    tax_percent: x.tax ? x.tax.value : null,
    discount_percent: x.discount,
    stock_item_id: x.l.stockItemId,
  }));
  const linesRes = await session.supabase.from("fiscal_document_lines").insert(lineRows);
  if (linesRes.error) return { status: "error", message: errorMessage(m, linesRes.error) };
  refresh();
  redirect(`/faturacao/${id}`);
}

async function loadDoc(session: Awaited<ReturnType<typeof requireOnboardedSession>>, id: string): Promise<FiscalDocument | null> {
  if (!UUID.test(id)) return null;
  const { data } = await session.supabase.from("fiscal_documents").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * Finaliza no InvoiceXpress (passa a documento fiscal: número, ATCUD, assinatura; as guias são comunicadas à AT).
 * Depois: cria o valor a receber nas finanças (faturas) e dá baixa no stock, se pedido.
 */
export async function finalizeFiscalDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const doc = await loadDoc(session, formString(formData, "id"));
  if (!doc || doc.status !== "draft") return { status: "error", message: m.errors.fiscal_status_invalid };
  const accountId = formString(formData, "accountId");
  const ix = clientFor(connection);
  let result;
  try {
    result = await ix.changeState(doc.kind, doc.provider_id, "finalized");
    if (!result?.sequence_number || !result.atcud) result = (await ix.get(doc.kind, doc.provider_id)) ?? result;
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  const f = fiscalFields(result ?? { id: doc.provider_id, status: "final" }, doc.kind);
  const status = f.status === "draft" ? (doc.kind === "invoice_receipt" ? "settled" : "final") : f.status;
  const upd = await session.supabase.from("fiscal_documents").update({ ...f, status }).eq("id", doc.id);
  if (upd.error) return { status: "error", message: errorMessage(m, upd.error) };

  const notes: string[] = [];
  // Finanças: valor a receber (fatura) ou recebido (fatura-recibo e simplificada).
  const total = f.total_minor ?? doc.total_minor;
  if (!isGuide(doc.kind) && doc.kind !== "credit_note" && accountId && UUID.test(accountId) && total && total > 0) {
    const paid = doc.kind !== "invoice";
    const { data: tx, error } = await session.supabase
      .from("transactions")
      .insert({
        ...scopeFields(fin),
        account_id: accountId,
        kind: "income",
        category_id: null,
        counterparty: null,
        notes: null,
        amount_minor: total,
        currency_code: doc.currency_code,
        occurred_on: doc.issue_date,
        description: `${f.sequence_number ?? m.invoicing.kinds[doc.kind]} · ${doc.client_name}`.slice(0, 200),
        contact_id: doc.contact_id,
        project_id: doc.project_id,
        due_on: paid ? null : (doc.due_date ?? doc.issue_date),
        settled_minor: paid ? total : 0,
        net_minor: f.before_taxes_minor ?? null,
        tax_minor: f.taxes_minor ?? null,
        document_ref: f.sequence_number ?? null,
      })
      .select("id");
    if (error || !tx?.[0]) notes.push(m.invoicing.financeFailed);
    else await session.supabase.from("fiscal_documents").update({ transaction_id: tx[0].id }).eq("id", doc.id);
  }
  // Stock: saída das linhas ligadas a artigos.
  if (doc.stock_out) {
    const biz = businessScope(session);
    const { data: lines } = await session.supabase.from("fiscal_document_lines").select("*").eq("document_id", doc.id).not("stock_item_id", "is", null);
    if (lines?.length && biz.canWrite) {
      let failed = 0;
      for (const l of lines) {
        const { error } = await session.supabase.from("stock_movements").insert({
          ...businessScopeFields(biz),
          item_id: l.stock_item_id!,
          kind: "out",
          quantity: String(l.quantity),
          occurred_on: doc.issue_date,
          notes: `${f.sequence_number ?? ""} ${doc.client_name}`.trim().slice(0, 500),
        });
        if (error) failed++;
      }
      await session.supabase.from("fiscal_documents").update({ stock_applied_at: new Date().toISOString() }).eq("id", doc.id);
      if (failed) notes.push(format(m.invoicing.stockFailed, { n: failed }));
    } else if (lines?.length) {
      notes.push(m.invoicing.stockNoPermission);
    }
  }
  refresh(doc.id);
  return { status: "success", message: [m.invoicing.finalized, ...notes].join(" ") };
}

export async function cancelFiscalDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const parsed = cancelFiscalSchema.safeParse({ id: formString(formData, "id"), reason: formString(formData, "reason") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const doc = await loadDoc(session, parsed.data.id);
  if (!doc || (doc.status !== "final" && doc.status !== "settled")) return { status: "error", message: m.errors.fiscal_status_invalid };
  try {
    await clientFor(connection).changeState(doc.kind, doc.provider_id, "canceled", parsed.data.reason);
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  const upd = await session.supabase.from("fiscal_documents").update({ status: "canceled", cancel_reason: parsed.data.reason }).eq("id", doc.id);
  if (upd.error) return { status: "error", message: errorMessage(m, upd.error) };
  const notes: string[] = [];
  // O valor a receber ainda não recebido deixa de existir; se já houve recebimentos, fica e avisa.
  if (doc.transaction_id) {
    const { data: tx } = await session.supabase.from("transactions").select("settled_minor, kind").eq("id", doc.transaction_id).maybeSingle();
    if (tx && Number(tx.settled_minor) === 0) await session.supabase.from("transactions").delete().eq("id", doc.transaction_id);
    else if (tx) notes.push(m.invoicing.cancelPaidNote);
  }
  // Stock: devolve as saídas feitas por este documento (entrada ao custo médio atual).
  if (doc.stock_applied_at) {
    const biz = businessScope(session);
    const { data: lines } = await session.supabase.from("fiscal_document_lines").select("stock_item_id, quantity").eq("document_id", doc.id).not("stock_item_id", "is", null);
    for (const l of lines ?? []) {
      const { data: item } = await session.supabase.from("stock_items").select("average_cost_minor").eq("id", l.stock_item_id!).maybeSingle();
      if (!item || !biz.canWrite) continue;
      await session.supabase.from("stock_movements").insert({
        ...businessScopeFields(biz),
        item_id: l.stock_item_id!,
        kind: "in",
        quantity: String(l.quantity),
        unit_cost_minor: item.average_cost_minor,
        occurred_on: new Date().toISOString().slice(0, 10),
        notes: `${m.invoicing.cancelStockNote} ${doc.sequence_number ?? ""}`.trim(),
      });
    }
  }
  refresh(doc.id);
  return { status: "success", message: [m.invoicing.canceled, ...notes].join(" ") };
}

/** Rascunho apagado no InvoiceXpress e aqui. */
export async function deleteDraftAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const doc = await loadDoc(session, formString(formData, "id"));
  if (!doc || doc.status !== "draft") return { status: "error", message: m.errors.fiscal_status_invalid };
  try {
    await clientFor(connection).changeState(doc.kind, doc.provider_id, "deleted");
  } catch (e) {
    // Se já não existe lá, apaga-se só a cópia.
    if (!(e instanceof InvoicingError && e.code === "not_found")) return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  await session.supabase.from("fiscal_documents").delete().eq("id", doc.id);
  refresh();
  redirect("/faturacao");
}

/** Nota de crédito total de uma fatura finalizada (fica em rascunho para rever e finalizar). */
export async function creditNoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const doc = await loadDoc(session, formString(formData, "id"));
  if (!doc || !["invoice", "invoice_receipt", "simplified_invoice"].includes(doc.kind) || !["final", "settled"].includes(doc.status)) {
    return { status: "error", message: m.errors.fiscal_status_invalid };
  }
  const { data: lines } = await session.supabase.from("fiscal_document_lines").select("*").eq("document_id", doc.id).order("position");
  const uid = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  let created;
  try {
    created = await clientFor(connection).create("credit_note", {
      date: ixDate(today),
      client: { name: doc.client_name, ...(doc.client_fiscal_id ? { fiscal_id: doc.client_fiscal_id } : {}), country: doc.client_country ?? "Portugal" },
      items: (lines ?? []).map((l) => ({
        name: l.name,
        ...(l.description ? { description: l.description } : {}),
        unit_price: fromMinor(BigInt(l.unit_price_minor)),
        quantity: Number(l.quantity),
        ...(Number(l.discount_percent) > 0 ? { discount: Number(l.discount_percent) } : {}),
        ...(l.tax_name ? { tax: { name: l.tax_name } } : {}),
      })),
      owner_invoice_id: doc.provider_id,
      ...(doc.tax_exemption ? { tax_exemption: doc.tax_exemption } : {}),
      observations: format(m.invoicing.creditNoteObservation, { number: doc.sequence_number ?? "" }),
      proprietary_uid: uid,
    });
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  const f = fiscalFields(created, "credit_note");
  const { data, error } = await session.supabase
    .from("fiscal_documents")
    .insert({
      ...scopeFields(fin),
      connection_id: connection.id,
      kind: "credit_note",
      status: "draft",
      provider_id: created.id,
      proprietary_uid: uid,
      contact_id: doc.contact_id,
      client_name: doc.client_name,
      client_fiscal_id: doc.client_fiscal_id,
      client_country: doc.client_country,
      project_id: doc.project_id,
      owner_document_id: doc.id,
      issue_date: today,
      currency_code: doc.currency_code,
      before_taxes_minor: f.before_taxes_minor,
      taxes_minor: f.taxes_minor,
      total_minor: f.total_minor,
      tax_exemption: doc.tax_exemption,
    })
    .select("id");
  const id = data?.[0]?.id;
  if (error || !id) return { status: "error", message: errorMessage(m, error) };
  await session.supabase.from("fiscal_document_lines").insert(
    (lines ?? []).map((l) => ({
      document_id: id,
      position: l.position,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit_price_minor: l.unit_price_minor,
      tax_name: l.tax_name,
      tax_percent: l.tax_percent,
      discount_percent: l.discount_percent,
      stock_item_id: null,
    })),
  );
  refresh();
  redirect(`/faturacao/${id}`);
}

/** Volta a ler o documento no InvoiceXpress (estado, código AT das guias, link). */
export async function refreshFiscalDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const doc = await loadDoc(session, formString(formData, "id"));
  if (!doc) return { status: "error", message: m.errors.forbidden };
  try {
    const remote = await clientFor(connection).get(doc.kind, doc.provider_id);
    if (remote) {
      const f = fiscalFields(remote, doc.kind);
      const keepStatus = doc.status === "draft" || doc.status === "canceled" || !(f.status === "final" || f.status === "settled");
      await session.supabase
        .from("fiscal_documents")
        .update({
          at_doc_code: f.at_doc_code ?? doc.at_doc_code,
          permalink: f.permalink ?? doc.permalink,
          status: keepStatus ? doc.status : f.status,
        })
        .eq("id", doc.id);
    }
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  refresh(doc.id);
  return { status: "success", message: m.invoicing.refreshed };
}

export async function emailFiscalDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, fin, connection } = await ctx();
  if (!fin.canWrite || !connection) return { status: "error", message: m.errors.forbidden };
  const doc = await loadDoc(session, formString(formData, "id"));
  const email = formString(formData, "email").trim();
  if (!doc || doc.status === "draft") return { status: "error", message: m.errors.fiscal_status_invalid };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "error", fieldErrors: { email: m.errors.email_invalid } };
  try {
    await clientFor(connection).sendEmail(
      doc.kind,
      doc.provider_id,
      email,
      format(m.invoicing.emailSubject, { kind: m.invoicing.kinds[doc.kind], number: doc.sequence_number ?? "" }),
      format(m.invoicing.emailBody, { client: doc.client_name }),
    );
  } catch (e) {
    return { status: "error", message: invoicingErrorMessage(m, e) };
  }
  return { status: "success", message: m.invoicing.emailSent };
}
