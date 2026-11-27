import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { getI18n } from "@/lib/i18n";
import { loadQuoteDocument } from "@/lib/quote-document-data";
import { numericToString } from "@/lib/quotes";
import { getSession } from "@/lib/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Orçamento", robots: { index: false } };

/**
 * Documento para o cliente: mostra PREÇOS, nunca custos internos nem margem, agrupados por serviço
 * (secção) com subtotal. O mesmo modelo gera o PDF (/api/orcamentos/[id]/pdf).
 */
export default async function PrintQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/entrar?next=${encodeURIComponent(`/imprimir/orcamento/${id}`)}`);
  const doc = await loadQuoteDocument(session, id);
  if (!doc) notFound();
  const { quote, issuer, model } = doc;
  const t = m.quotes.print_;
  const fmt = (v: bigint) => formatMoney(v, quote.currency_code, doc.minorUnit, locale);
  const qty = (q: string) => q.replace(".", ",");
  const discount = BigInt(quote.discount_minor);
  const mixed = model.productsMinor > 0n && model.servicesMinor > 0n;
  const discountLabel = quote.discount_percent > 0 ? `${t.discount} (${numericToString(quote.discount_percent).replace(".", ",")} %)` : t.discount;
  const taxRate = numericToString(quote.tax_rate_percent).replace(".", ",");
  const grouped = model.groups.some((g) => g.section !== null);

  return (
    <main className="mx-auto max-w-[820px] bg-white px-4 py-6 text-[#111] sm:px-6 sm:py-8 print:max-w-none print:px-0 print:py-0">
      <style>{`html,body{background:#fff!important;color:#111}main>*{animation:none!important}@page{margin:16mm}`}</style>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <a href={`/orcamentos/${quote.id}`} className="text-sm text-[#5a5a5a] hover:underline">← {t.back}</a>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/orcamentos/${quote.id}/pdf`}
            className="inline-flex h-10 items-center rounded-md bg-[#FF851B] px-4 text-sm font-semibold text-[#090909] hover:bg-[#ff9a40]"
          >
            {t.pdf}
          </a>
          <PrintButton label={t.button} />
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#111] pb-6">
        <div>
          <p className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>{issuer.name}</p>
          {issuer.taxId ? <p className="text-sm text-[#5a5a5a]">{issuer.taxId}</p> : null}
          <p className="text-sm text-[#5a5a5a]">{issuer.email}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#E06A10]">{t.title}</p>
          <p className="tabular text-xl font-bold">{quote.number}</p>
          <p className="text-sm text-[#5a5a5a]">{format(t.issued, { date: formatDate(quote.updated_at, locale, doc.timezone) })}</p>
          {quote.valid_until ? <p className="text-sm text-[#5a5a5a]">{format(t.valid, { date: formatDate(quote.valid_until, locale, "UTC") })}</p> : null}
        </div>
      </header>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5a5a5a]">{m.quotes.client}</p>
          <p className="mt-1 font-semibold">{quote.client_name ?? "—"}</p>
          {quote.client_tax_id ? <p className="text-sm">{quote.client_tax_id}</p> : null}
          {quote.client_address ? <p className="text-sm">{quote.client_address}</p> : null}
          {quote.client_email ? <p className="text-sm">{quote.client_email}</p> : null}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5a5a5a]">{m.quotes.fields.title}</p>
          <p className="mt-1 font-semibold">{quote.title}</p>
          {quote.description ? <p className="mt-1 whitespace-pre-line text-sm text-[#3a3a3a]">{quote.description}</p> : null}
        </div>
      </section>

      {/* Cabeçalho das colunas (ecrã largo e impressão); no telemóvel cada linha mostra qtd. × preço por baixo. */}
      <div className="hidden grid-cols-[1fr_96px_112px_112px] gap-3 border-b border-[#111] pb-2 text-xs font-semibold uppercase tracking-wider text-[#5a5a5a] sm:grid print:grid">
        <span>{m.quotes.line.description}</span>
        <span className="text-right">{t.quantity}</span>
        <span className="text-right">{t.unitPrice}</span>
        <span className="text-right">{t.amount}</span>
      </div>

      <div className="flex flex-col">
        {model.groups.map((g, gi) => (
          <section key={gi} className="break-inside-avoid-page border-b border-[#e4e2de] py-3 last:border-b-[#111]" aria-label={g.section ?? (grouped ? t.otherLines : undefined)}>
            {g.section || (grouped && model.groups.length > 1) ? (
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <h3 className="font-bold" style={{ fontFamily: "var(--font-heading)" }}>{g.section ?? t.otherLines}</h3>
                <span className="tabular whitespace-nowrap font-bold">{fmt(g.subtotalMinor)}</span>
              </div>
            ) : null}
            <ul className="flex flex-col">
              {g.lines.map((l) => (
                <li
                  key={l.id}
                  className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5 text-sm sm:grid-cols-[1fr_96px_112px_112px] print:grid-cols-[1fr_96px_112px_112px]"
                >
                  <span className={g.section ? "pl-3 text-[#2a2a2a]" : ""}>{l.description}</span>
                  <span className="tabular hidden whitespace-nowrap text-right sm:block print:block">
                    {qty(l.quantity)} {l.unit ?? ""}
                  </span>
                  <span className="tabular hidden whitespace-nowrap text-right sm:block print:block">{fmt(l.unitPriceMinor)}</span>
                  <span className="tabular whitespace-nowrap text-right font-medium">{fmt(l.amountMinor)}</span>
                  <span className={`tabular col-span-2 text-xs text-[#5a5a5a] sm:hidden print:hidden ${g.section ? "pl-3" : ""}`}>
                    {qty(l.quantity)} {l.unit ?? ""} × {fmt(l.unitPriceMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <dl className="ml-auto mt-6 flex w-full max-w-xs flex-col gap-1.5 text-sm">
        {mixed ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-[#5a5a5a]">{t.products}</dt>
              <dd className="tabular">{fmt(model.productsMinor)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#5a5a5a]">{t.services}</dt>
              <dd className="tabular">{fmt(model.servicesMinor)}</dd>
            </div>
          </>
        ) : null}
        {discount > 0n ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-[#5a5a5a]">{t.subtotal}</dt>
              <dd className="tabular">{fmt(model.subtotalMinor)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#5a5a5a]">{discountLabel}</dt>
              <dd className="tabular">− {fmt(discount)}</dd>
            </div>
          </>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-[#5a5a5a]">{m.quotes.summary.price}</dt>
          <dd className="tabular">{fmt(BigInt(quote.price_before_tax_minor))}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[#5a5a5a]">{quote.tax_label ?? m.quotes.summary.tax} ({taxRate} %)</dt>
          <dd className="tabular">{fmt(BigInt(quote.tax_minor))}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-4 border-t-2 border-[#111] pt-2 text-base">
          <dt className="font-bold">{m.quotes.summary.total}</dt>
          <dd className="tabular font-bold">{fmt(BigInt(quote.total_minor))}</dd>
        </div>
      </dl>

      {quote.conditions ? (
        <section className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5a5a5a]">{m.quotes.sections.conditions}</p>
          <p className="mt-2 whitespace-pre-line text-sm">{quote.conditions}</p>
        </section>
      ) : null}
      <p className="mt-12 border-t border-[#e4e2de] pt-3 text-xs text-[#5a5a5a]">{t.disclaimer}</p>
    </main>
  );
}
