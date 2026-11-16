import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney } from "@anen/i18n";
import type { QuoteStatus } from "@anen/types";
import { Alert, Badge, ButtonLink, PageHeader } from "@/components/ui";
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
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {(quotes ?? []).map((q) => (
              <li key={q.id}>
                <Link href={`/orcamentos/${q.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-graphite/50 sm:px-6">
                  <span className="tabular w-28 text-sm text-subtle">{q.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{q.title}</span>
                    <span className="block truncate text-xs text-subtle">
                      {q.client_name ?? m.quotes.noClient} · {formatDate(q.updated_at, locale, scope.timezone)}
                    </span>
                  </span>
                  <Badge tone={statusTone(q.status)}>{m.quotes.statuses[q.status]}</Badge>
                  <span className="tabular w-32 text-right font-semibold">{formatMoney(BigInt(q.total_minor), q.currency_code, units.get(q.currency_code) ?? 2, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
