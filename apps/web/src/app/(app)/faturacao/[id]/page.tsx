import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { FiscalDocument, FiscalDocumentLine } from "@anen/types";
import { Alert, Badge, Section, buttonClass } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { loadInvoicing } from "@/lib/invoicing/service";
import { requireOnboardedSession } from "@/lib/session";
import { formatQuantity } from "../../inventario/quantity";
import { CancelForm, DocActionButton, EmailForm, FinalizeForm } from "../invoicing-forms";
import { statusTone } from "../status";

export const metadata: Metadata = { title: "Documento" };

export default async function FiscalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.invoicing;
  const d = t.detail;
  const { fin, connection } = await loadInvoicing(session);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!fin.canRead) return <Alert tone="info">{t.noPermission}</Alert>;
  const { data } = await session.supabase.from("fiscal_documents").select("*").eq("id", id).maybeSingle();
  const doc: FiscalDocument | null = data;
  if (!doc) notFound();

  const [linesRes, accountsRes, originRes] = await Promise.all([
    session.supabase.from("fiscal_document_lines").select("*").eq("document_id", id).order("position"),
    fin.canWrite
      ? session.supabase.from("financial_accounts").select("id, name").eq(fin.column, fin.value).eq("currency_code", doc.currency_code).is("archived_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    doc.owner_document_id
      ? session.supabase.from("fiscal_documents").select("id, kind, sequence_number").eq("id", doc.owner_document_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lines: FiscalDocumentLine[] = linesRes.data ?? [];
  const money = (v: number | null) => (v === null ? "—" : formatMoney(BigInt(v), doc.currency_code, 2, locale));
  const day = (v: string) => formatDate(v, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const isGuide = doc.kind === "transport" || doc.kind === "shipping";
  const issued = doc.status === "final" || doc.status === "settled";
  const canAct = fin.canWrite && Boolean(connection);

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link href="/faturacao" className="text-sm text-muted hover:text-paper">← {t.title}</Link>
          <h1 className="flex flex-wrap items-center gap-3 break-words text-2xl font-bold sm:text-[28px]">
            {t.kinds[doc.kind]} {doc.sequence_number ?? ""}
            <Badge tone={statusTone(doc.status)}>{t.statuses[doc.status]}</Badge>
          </h1>
          <p className="break-words text-sm text-subtle">
            {doc.client_name}
            {doc.client_fiscal_id ? ` · NIF ${doc.client_fiscal_id}` : ""} · {day(doc.issue_date)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {issued || doc.status === "canceled" ? (
            <a href={`/faturacao/${doc.id}/pdf`} className={buttonClass("secondary")}>{d.pdf}</a>
          ) : null}
          {doc.permalink ? (
            <a href={doc.permalink} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>{d.openInIx}</a>
          ) : null}
        </div>
      </header>

      {doc.status === "draft" ? <Alert tone="info">{d.draftNotice}</Alert> : null}
      {doc.status === "canceled" && doc.cancel_reason ? <Alert tone="error">{format(d.canceledReason, { reason: doc.cancel_reason })}</Alert> : null}

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          { label: d.number, value: doc.sequence_number ?? "—" },
          { label: d.atcud, value: doc.atcud ?? "—" },
          isGuide ? { label: d.atCode, value: doc.at_doc_code ?? (issued ? d.atCodePending : "—") } : { label: d.hash, value: doc.saft_hash ?? "—" },
        ].map((k) => (
          <div key={k.label} className="flex flex-col gap-1 bg-surface p-4">
            <dt className="text-sm text-muted">{k.label}</dt>
            <dd className="break-all font-semibold">{k.value}</dd>
          </div>
        ))}
      </dl>

      <Section title={m.invoicing.form.lines}>
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line text-left text-subtle">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{m.invoicing.form.lineName}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{m.invoicing.form.quantity}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{m.invoicing.form.unitPrice}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">{m.invoicing.form.discount}</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">{m.invoicing.form.tax}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 sm:px-6">
                    <span className="flex flex-col">
                      <span className="break-words">{l.name}</span>
                      {l.description ? <span className="text-xs text-subtle">{l.description}</span> : null}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{formatQuantity(l.quantity, locale)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{money(l.unit_price_minor)}</td>
                  <td className="tabular px-3 py-2.5 text-right">{Number(l.discount_percent) > 0 ? `${formatQuantity(l.discount_percent, locale)} %` : "—"}</td>
                  <td className="tabular px-5 py-2.5 text-right sm:px-6">{l.tax_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isGuide ? (
          <dl className="tabular mt-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-6"><dt className="text-muted">{m.invoicing.form.subtotal}</dt><dd>{money(doc.before_taxes_minor)}</dd></div>
            <div className="flex gap-6"><dt className="text-muted">{m.invoicing.form.vat}</dt><dd>{money(doc.taxes_minor)}</dd></div>
            <div className="flex gap-6 text-base font-bold"><dt>{m.invoicing.form.total}</dt><dd>{money(doc.total_minor)}</dd></div>
          </dl>
        ) : (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[{ label: m.invoicing.form.addressFrom, a: doc.address_from }, { label: m.invoicing.form.addressTo, a: doc.address_to }].map((x) => (
              <div key={x.label} className="rounded-lg border border-line p-3">
                <p className="text-subtle">{x.label}</p>
                <p>{x.a ? `${x.a.detail}, ${x.a.postal_code} ${x.a.city}, ${x.a.country}` : "—"}</p>
              </div>
            ))}
            <p className="text-muted">
              {m.invoicing.form.loadedAt}: {doc.loaded_at ? formatDate(doc.loaded_at, locale, "Europe/Lisbon", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              {doc.license_plate ? ` · ${m.invoicing.form.licensePlate}: ${doc.license_plate}` : ""}
            </p>
          </div>
        )}
      </Section>

      {(doc.transaction_id || originRes.data || doc.stock_applied_at) ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {doc.transaction_id ? <Link href="/financas/em-aberto" className="text-muted underline hover:text-paper">{d.transaction}</Link> : null}
          {originRes.data ? (
            <Link href={`/faturacao/${originRes.data.id}`} className="text-muted underline hover:text-paper">
              {d.origin}: {t.kinds[originRes.data.kind]} {originRes.data.sequence_number}
            </Link>
          ) : null}
          {doc.stock_applied_at ? <span className="text-muted">{d.stockApplied}</span> : null}
        </div>
      ) : null}

      {canAct && doc.status === "draft" ? (
        <Section title={d.finalizeTitle} description={d.finalizeHint}>
          <div className="flex flex-col gap-4">
            <FinalizeForm m={m} id={doc.id} accounts={accountsRes.data ?? []} withFinance={!isGuide && doc.kind !== "credit_note"} />
            <DocActionButton m={m} id={doc.id} kind="delete" />
          </div>
        </Section>
      ) : null}

      {canAct && issued ? (
        <>
          <div className="flex flex-wrap gap-2">
            <DocActionButton m={m} id={doc.id} kind="refresh" />
            {["invoice", "invoice_receipt", "simplified_invoice"].includes(doc.kind) ? <DocActionButton m={m} id={doc.id} kind="credit" /> : null}
          </div>
          <Section title={d.emailTitle}>
            <EmailForm m={m} id={doc.id} email={doc.client_email} />
          </Section>
          <Section title={d.cancelTitle}>
            <CancelForm m={m} id={doc.id} />
          </Section>
        </>
      ) : null}
    </>
  );
}
