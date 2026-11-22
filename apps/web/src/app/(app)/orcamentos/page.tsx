import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { QuoteStatus } from "@anen/types";
import { Alert, ButtonLink, PageHeader } from "@/components/ui";
import { QuoteList } from "./quote-list";
import { statusTone } from "./status";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";

export const metadata: Metadata = { title: "Orçamentos" };

const STATUS_FILTERS: QuoteStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "cancelled"];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  const params = await searchParams;
  if (!scope.canRead) {
    return (
      <>
        <PageHeader title={m.quotes.title} />
        <Alert tone="info">{m.errors.forbidden}</Alert>
      </>
    );
  }
  const status = STATUS_FILTERS.includes(params.estado as QuoteStatus) ? (params.estado as QuoteStatus) : null;
  let query = session.supabase.from("quotes").select("*").eq(scope.column, scope.value).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const [{ data: quotes }, { data: currencies }] = await Promise.all([query, session.supabase.from("currencies").select("code, minor_unit")]);
  const units = new Map((currencies ?? []).map((c) => [c.code, c.minor_unit]));

  return (
    <>
      <PageHeader
        title={m.quotes.title}
        description={m.quotes.subtitle}
        actions={scope.canWrite ? <ButtonLink href="/orcamentos/novo">{m.quotes.new}</ButtonLink> : undefined}
      />
      {Number(params.apagados) > 0 ? (
        <Alert tone="success">{format(m.quotes.deleted, { count: Number(params.apagados) })}</Alert>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label={m.quotes.status}>
        <Link href="/orcamentos" className={`h-9 rounded-full border px-3 text-sm leading-9 ${!status ? "border-brand text-paper" : "border-line text-muted hover:text-paper"}`}>
          {m.finance.tx.filters.all}
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link key={s} href={`/orcamentos?estado=${s}`} className={`h-9 rounded-full border px-3 text-sm leading-9 ${status === s ? "border-brand text-paper" : "border-line text-muted hover:text-paper"}`}>
            {m.quotes.statuses[s]}
          </Link>
        ))}
      </nav>
      {(quotes ?? []).length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-graphite-soft p-8">
          <p className="text-muted">{m.quotes.empty}</p>
          {scope.canWrite ? <ButtonLink href="/orcamentos/novo">{m.quotes.new}</ButtonLink> : null}
        </div>
      ) : (
        <QuoteList
          m={m}
          canDelete={scope.canWrite}
          rows={(quotes ?? []).map((q) => ({
            id: q.id,
            number: q.number,
            title: q.title,
            subtitle: `${q.client_name ?? m.quotes.noClient} · ${formatDate(q.updated_at, locale, scope.timezone)}`,
            statusLabel: m.quotes.statuses[q.status],
            tone: statusTone(q.status),
            total: formatMoney(BigInt(q.total_minor), q.currency_code, units.get(q.currency_code) ?? 2, locale),
          }))}
        />
      )}
    </>
  );
}
