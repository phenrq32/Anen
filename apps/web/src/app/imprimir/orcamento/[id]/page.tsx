import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { allocate, moneyFromMinor } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { getI18n } from "@/lib/i18n";
import { numericToString } from "@/lib/quotes";
import { getSession } from "@/lib/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Orçamento", robots: { index: false } };

/**
 * Documento para o cliente: mostra PREÇOS, nunca custos internos nem margem.
 * O preço sem imposto é repartido pelas linhas na proporção do custo, sem perder cêntimos.
 */
export default async function PrintQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/entrar?next=${encodeURIComponent(`/imprimir/orcamento/${id}`)}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: quote } = await session.supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (!quote) notFound();
  const [{ data: items }, { data: currency }, orgRes] = await Promise.all([
    session.supabase.from("quote_items").select("*").eq("quote_id", id).order("position"),
    session.supabase.from("currencies").select("minor_unit").eq("code", quote.currency_code).maybeSingle(),
    quote.organization_id ? session.supabase.from("organizations").select("*").eq("id", quote.organization_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const unit = currency?.minor_unit ?? 2;
  const fmt = (v: bigint) => formatMoney(v, quote.currency_code, unit, locale);
  const org = orgRes.data;
  const lines = items ?? [];
  const costs = lines.map((l) => BigInt(l.total_cost_minor));
  const price = moneyFromMinor(BigInt(quote.price_before_tax_minor), quote.currency_code);
  const linePrices = costs.some((c) => c > 0n) ? allocate(price, costs).map((p) => p.amountMinor) : costs.map(() => 0n);
  const tz = org?.timezone ?? session.preferences.timezone;
  const taxRate = numericToString(quote.tax_rate_percent).replace(".", ",");

  return (
    <main className="mx-auto max-w-[820px] bg-white px-6 py-8 text-[#111] print:max-w-none print:px-0 print:py-0">
      <style>{`html,body{background:#fff!important;color:#111}main>*{animation:none!important}@page{margin:16mm}`}</style>
      <div className="mb-8 flex justify-between gap-3 print:hidden">
        <a href={`/orcamentos/${quote.id}`} className="text-sm text-[#5a5a5a] hover:underline">← {m.quotes.print_.back}</a>
        <PrintButton label={m.quotes.print_.button} />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#111] pb-6">
        <div>
          <p className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {org ? (org.legal_name ?? org.name) : (session.profile.full_name ?? "")}
          </p>
          {org?.tax_id ? <p className="text-sm text-[#5a5a5a]">{org.tax_id}</p> : null}
          <p className="text-sm text-[#5a5a5a]">{session.user.email}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#E06A10]">{m.quotes.print_.title}</p>
          <p className="tabular text-xl font-bold">{quote.number}</p>
          <p className="text-sm text-[#5a5a5a]">{format(m.quotes.print_.issued, { date: formatDate(quote.updated_at, locale, tz) })}</p>
          {quote.valid_until ? <p className="text-sm text-[#5a5a5a]">{format(m.quotes.print_.valid, { date: formatDate(quote.valid_until, locale, "UTC") })}</p> : null}
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
          {quote.description ? <p className="mt-1 whitespace-pre-line text-sm">{quote.description}</p> : null}
        </div>
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#111] text-left text-xs uppercase tracking-wider text-[#5a5a5a]">
            <th className="py-2 font-semibold">{m.quotes.line.description}</th>
            <th className="py-2 text-right font-semibold">{m.quotes.line.quantity}</th>
            <th className="py-2 text-right font-semibold">{m.quotes.print_.unitPrice}</th>
            <th className="py-2 text-right font-semibold">{m.quotes.print_.amount}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const qty = Number(l.quantity);
            const linePrice = linePrices[i] ?? 0n;
            const unitPrice = qty > 0 ? BigInt(Math.round(Number(linePrice) / qty)) : 0n;
            return (
              <tr key={l.id} className="border-b border-[#e4e2de] align-top">
                <td className="py-2.5 pr-3">{l.description}</td>
                <td className="tabular py-2.5 text-right whitespace-nowrap">
                  {numericToString(l.quantity).replace(".", ",")} {l.unit ?? ""}
                </td>
                <td className="tabular py-2.5 text-right whitespace-nowrap">{fmt(unitPrice)}</td>
                <td className="tabular py-2.5 text-right whitespace-nowrap font-medium">{fmt(linePrice)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="ml-auto mt-6 flex w-full max-w-xs flex-col gap-1.5 text-sm">
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
      <p className="mt-12 border-t border-[#e4e2de] pt-3 text-xs text-[#5a5a5a]">{m.quotes.print_.disclaimer}</p>
    </main>
  );
}
