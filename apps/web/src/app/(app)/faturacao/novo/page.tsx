import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "@anen/i18n";
import { NEW_FISCAL_KINDS, formatAmountInput } from "@anen/validation";
import { Alert, PageHeader, Section } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { loadInvoicing } from "@/lib/invoicing/service";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { DocumentForm, type DocumentDefaults } from "../document-form";

export const metadata: Metadata = { title: "Novo documento" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function NewFiscalDocumentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const { fin, connection } = await loadInvoicing(session);
  if (!fin.canWrite) return <Alert tone="info">{m.invoicing.readOnly}</Alert>;
  if (!connection) redirect("/faturacao");
  const biz = businessScope(session);
  const params = await searchParams;

  const [contactsRes, projectsRes, stockRes] = await Promise.all([
    biz.canRead
      ? session.supabase.from("contacts").select("id, name, tax_id, email, address, kind").eq(biz.column, biz.value).is("archived_at", null).in("kind", ["client", "both"]).order("name").limit(2000)
      : Promise.resolve({ data: [] as { id: string; name: string; tax_id: string | null; email: string | null; address: string | null }[] }),
    biz.canRead
      ? session.supabase.from("projects").select("id, name").eq(biz.column, biz.value).in("status", ["planned", "active"]).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    biz.canRead
      ? session.supabase.from("stock_items").select("id, name, unit").eq(biz.column, biz.value).eq("currency_code", "EUR").is("archived_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; unit: string }[] }),
  ]);

  // A partir de um orçamento aceite: cliente, projeto e uma linha com o preço sem impostos (já com desconto).
  const defaults: DocumentDefaults = {};
  const kind = NEW_FISCAL_KINDS.find((k) => k === params.tipo);
  if (kind) defaults.kind = kind;
  if (params.contacto && UUID.test(params.contacto)) defaults.contactId = params.contacto;
  const qs = quotesScope(session);
  if (params.orcamento && UUID.test(params.orcamento) && qs.canRead) {
    const { data: quote } = await session.supabase.from("quotes").select("*").eq("id", params.orcamento).eq(qs.column, qs.value).maybeSingle();
    if (quote && quote.currency_code === "EUR") {
      const { data: project } = await session.supabase.from("projects").select("id").eq("quote_id", quote.id).maybeSingle();
      const taxMatch = connection.taxes.find((x) => Number(x.value) === Number(quote.tax_rate_percent));
      if (quote.client_contact_id) defaults.contactId = quote.client_contact_id;
      if (project) defaults.projectId = project.id;
      defaults.quoteId = quote.id;
      defaults.reference = quote.number;
      defaults.note = format(m.invoicing.form.fromQuote, { number: quote.number });
      defaults.lines = [
        {
          name: quote.title.slice(0, 60),
          description: `${quote.number}`.slice(0, 200),
          quantity: "1",
          unitPrice: formatAmountInput(BigInt(quote.price_before_tax_minor), 2),
          taxName: taxMatch?.name ?? connection.taxes.find((x) => x.default_tax === 1)?.name ?? "",
          discount: "0",
          stockItemId: "",
        },
      ];
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Link href="/faturacao" className="text-sm text-muted hover:text-paper">← {m.invoicing.title}</Link>
        <PageHeader title={m.invoicing.new} description={m.invoicing.legal} />
      </div>
      <Section title={m.invoicing.new}>
        <DocumentForm
          m={m}
          locale={locale}
          today={todayIn(fin.timezone)}
          contacts={contactsRes.data ?? []}
          projects={projectsRes.data ?? []}
          stockItems={stockRes.data ?? []}
          taxes={connection.taxes}
          loadAddress={connection.load_address}
          defaults={defaults}
        />
      </Section>
    </>
  );
}
