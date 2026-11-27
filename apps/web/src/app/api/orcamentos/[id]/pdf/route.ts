import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { getI18n } from "@/lib/i18n";
import { loadQuoteDocument } from "@/lib/quote-document-data";
import { renderQuotePdf } from "@/lib/quote-pdf";
import { numericToString } from "@/lib/quotes";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fontsDir = join(process.cwd(), "src/assets/fonts");
let fonts: Promise<{ regular: Uint8Array; bold: Uint8Array; heading: Uint8Array }> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(join(fontsDir, "inter-latin-400-normal.woff")),
    readFile(join(fontsDir, "inter-latin-700-normal.woff")),
    readFile(join(fontsDir, "manrope-latin-800-normal.woff")),
  ]).then(([regular, bold, heading]) => ({ regular, bold, heading })));

/** PDF do orçamento para o cliente (abre no navegador; dá para guardar, imprimir ou partilhar). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const doc = await loadQuoteDocument(session, id);
  if (!doc) return new Response(null, { status: 404 });
  const { m, locale } = await getI18n();
  const { quote, model } = doc;
  const t = m.quotes.print_;
  const money = (v: bigint) => formatMoney(v, quote.currency_code, doc.minorUnit, locale);
  const discount = BigInt(quote.discount_minor);
  const taxRate = numericToString(quote.tax_rate_percent).replace(".", ",");
  const totals: { label: string; value: string; strong?: boolean }[] = [];
  if (model.productsMinor > 0n && model.servicesMinor > 0n) {
    totals.push({ label: t.products, value: money(model.productsMinor) }, { label: t.services, value: money(model.servicesMinor) });
  }
  if (discount > 0n) {
    const label = quote.discount_percent > 0 ? `${t.discount} (${numericToString(quote.discount_percent).replace(".", ",")} %)` : t.discount;
    totals.push({ label: t.subtotal, value: money(model.subtotalMinor) }, { label, value: `− ${money(discount)}` });
  }
  totals.push(
    { label: m.quotes.summary.price, value: money(BigInt(quote.price_before_tax_minor)) },
    { label: `${quote.tax_label ?? m.quotes.summary.tax} (${taxRate} %)`, value: money(BigInt(quote.tax_minor)) },
    { label: m.quotes.summary.total, value: money(BigInt(quote.total_minor)), strong: true },
  );
  const bytes = await renderQuotePdf({
    fonts: await loadFonts(),
    labels: {
      title: t.title,
      client: m.quotes.client,
      quoteTitle: m.quotes.fields.title,
      description: m.quotes.line.description,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      amount: t.amount,
      otherLines: t.otherLines,
      conditions: m.quotes.sections.conditions,
      disclaimer: t.disclaimer,
      page: (page, pages) => format(t.page, { page, pages }),
    },
    issuer: doc.issuer,
    number: quote.number,
    dates: [
      format(t.issued, { date: formatDate(quote.updated_at, locale, doc.timezone) }),
      ...(quote.valid_until ? [format(t.valid, { date: formatDate(quote.valid_until, locale, "UTC") })] : []),
    ],
    client: {
      name: quote.client_name ?? "",
      lines: [quote.client_tax_id, quote.client_address, quote.client_email].filter((v): v is string => Boolean(v)),
    },
    quoteTitle: quote.title,
    quoteDescription: quote.description,
    model,
    money,
    quantity: (q, unit) => `${q.replace(".", ",")}${unit ? ` ${unit}` : ""}`,
    totals,
    conditions: quote.conditions,
  });
  const name = `${t.title}-${quote.number}`.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.normalize("NFD").replace(/[^\x20-\x7e]/g, "")}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`,
      "Cache-Control": "private, no-store",
    },
  });
}
