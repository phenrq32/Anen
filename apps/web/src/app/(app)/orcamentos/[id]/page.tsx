import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatAmountInputSafe, formatDate } from "./helpers";
import type { QuoteStatus } from "@anen/types";
import { formatMoney } from "@anen/i18n";
import { InlineAction } from "@/components/forms";
import { Alert, Badge, buttonClass } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { CreateProjectFromQuoteButton } from "../../projetos/project-form";
import { numericToString, quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { deleteQuoteAction, setQuoteStatusAction } from "../actions";
import { statusTone } from "../status";
import { QuoteEditor } from "../quote-editor";

export const metadata: Metadata = { title: "Orçamento" };

const NEXT: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["accepted", "rejected", "expired", "draft"],
  accepted: [],
  rejected: ["draft"],
  expired: ["draft"],
  cancelled: ["draft"],
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = quotesScope(session);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: quote }, { data: items }, { data: history }, { data: versions }] = await Promise.all([
    session.supabase.from("quotes").select("*").eq("id", id).maybeSingle(),
    session.supabase.from("quote_items").select("*").eq("quote_id", id).order("position"),
    session.supabase.from("quote_status_history").select("*").eq("quote_id", id).order("changed_at", { ascending: false }),
    session.supabase.from("quote_versions").select("id, version, created_at, created_by, quote_id").eq("quote_id", id).order("version", { ascending: false }).limit(20),
  ]);
  if (!quote) notFound();
  const { data: currency } = await session.supabase.from("currencies").select("minor_unit").eq("code", quote.currency_code).maybeSingle();
  const minorUnit = currency?.minor_unit ?? 2;
  const editable = scope.canWrite && (quote.status === "draft" || quote.status === "sent");
  // Modelo com preço de origem: referência só para o profissional (não vai para o documento do cliente).
  const reference =
    quote.service_model_set_id && quote.service_model_key
      ? (
          await session.supabase
            .from("quote_service_models")
            .select("unit, recommended_minor, range_min_minor, range_max_minor")
            .eq("set_id", quote.service_model_set_id)
            .eq("service_key", quote.service_model_key)
            .maybeSingle()
        ).data
      : null;
  const biz = businessScope(session);
  const { data: linkedProject } =
    quote.status === "accepted" && biz.canRead
      ? await session.supabase.from("projects").select("id").eq("quote_id", quote.id).maybeSingle()
      : { data: null };
  // Clientes do cadastro (ativos, e o ligado mesmo que arquivado). Sem permissão de leitura: só se mantém a ligação.
  const { data: clientRows } = biz.canRead
    ? await session.supabase
        .from("contacts")
        .select("id, name, email, tax_id, address, archived_at")
        .eq(biz.column, biz.value)
        .in("kind", ["client", "both"])
        .order("name")
        .limit(500)
    : { data: null };
  const clients = (clientRows ?? [])
    .filter((c) => !c.archived_at || c.id === quote.client_contact_id)
    .map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", taxId: c.tax_id ?? "", address: c.address ?? "" }));

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Link href="/orcamentos" className="text-sm text-muted hover:text-paper">← {m.quotes.title}</Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-[28px]">
            {quote.title}
            <Badge tone={statusTone(quote.status)}>{m.quotes.statuses[quote.status]}</Badge>
          </h1>
          <p className="tabular text-sm text-subtle">
            {quote.number} · {format(m.quotes.versionItem, { version: quote.version })}
            {quote.client_contact_id && biz.canRead ? (
              <>
                {" · "}
                <Link href={`/contactos/${quote.client_contact_id}`} className="underline-offset-2 hover:text-paper hover:underline">
                  {quote.client_name ?? m.quotes.client}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {linkedProject ? (
            <Link href={`/projetos/${linkedProject.id}`} className={buttonClass("primary")}>
              {m.business.projects.openProject}
            </Link>
          ) : quote.status === "accepted" && biz.canWrite ? (
            <CreateProjectFromQuoteButton m={m} quoteId={quote.id} />
          ) : null}
          {quote.status === "accepted" && quote.currency_code === "EUR" && financeScope(session).canWrite ? (
            <Link href={`/faturacao/novo?orcamento=${quote.id}`} className={buttonClass("secondary")}>
              {m.invoicing.fromQuoteButton}
            </Link>
          ) : null}
          <a href={`/imprimir/orcamento/${quote.id}`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
            {m.quotes.print}
          </a>
          {scope.canWrite
            ? NEXT[quote.status].map((s) => (
                <InlineAction
                  key={s}
                  action={setQuoteStatusAction}
                  fields={{ id: quote.id, status: s }}
                  label={m.quotes.actions[s]}
                  pendingLabel={m.common.saving}
                  variant={s === "accepted" ? "primary" : s === "cancelled" || s === "rejected" ? "danger" : "secondary"}
                />
              ))
            : null}
          {scope.canWrite ? (
            <InlineAction action={deleteQuoteAction} fields={{ id: quote.id }} label={m.quotes.delete} pendingLabel={m.common.saving} confirmMessage={m.quotes.confirmDelete} variant="danger" />
          ) : null}
        </div>
      </header>

      {!editable && scope.canWrite ? <Alert tone="info">{format(m.quotes.locked, { status: m.quotes.statuses[quote.status] })}</Alert> : null}

      {reference ? (
        <aside aria-label={m.quotes.models.referenceTitle} className="rounded-xl border border-line px-4 py-3 text-sm">
          <p className="font-medium">{m.quotes.models.referenceTitle}</p>
          <p className="tabular mt-1 text-muted">
            {format(m.quotes.models.reference, {
              price: formatMoney(BigInt(reference.recommended_minor), quote.currency_code, minorUnit, locale),
              unit: reference.unit,
              min: formatMoney(BigInt(reference.range_min_minor), quote.currency_code, minorUnit, locale),
              max: formatMoney(BigInt(reference.range_max_minor), quote.currency_code, minorUnit, locale),
            })}
          </p>
          <p className="mt-1 text-xs text-subtle">{m.quotes.models.marginNote}</p>
        </aside>
      ) : null}

      <QuoteEditor
        m={m}
        locale={locale}
        minorUnit={minorUnit}
        readOnly={!editable}
        clients={biz.canRead ? clients : null}
        quote={{
          id: quote.id,
          title: quote.title,
          description: quote.description ?? "",
          clientContactId: quote.client_contact_id ?? "",
          clientName: quote.client_name ?? "",
          clientEmail: quote.client_email ?? "",
          clientTaxId: quote.client_tax_id ?? "",
          clientAddress: quote.client_address ?? "",
          validUntil: quote.valid_until ?? "",
          margin: numericToString(quote.margin_percent).replace(".", ","),
          taxRate: numericToString(quote.tax_rate_percent).replace(".", ","),
          taxLabel: quote.tax_label ?? "",
          discountType: quote.discount_fixed_minor > 0 ? "amount" : quote.discount_percent > 0 ? "percent" : "none",
          discountValue:
            quote.discount_fixed_minor > 0
              ? formatAmountInputSafe(quote.discount_fixed_minor, minorUnit)
              : quote.discount_percent > 0
                ? numericToString(quote.discount_percent).replace(".", ",")
                : "",
          conditions: quote.conditions ?? "",
          currency: quote.currency_code,
        }}
        initialLines={(items ?? []).map((i) => ({
          key: i.id,
          kind: i.kind,
          nature: i.nature,
          description: i.description,
          quantity: numericToString(i.quantity).replace(".", ","),
          unit: i.unit ?? "",
          unitCost: formatAmountInputSafe(i.unit_cost_minor, minorUnit),
        }))}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="mb-3 text-base font-semibold">{m.quotes.history}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {(history ?? []).map((h) => (
              <li key={h.id} className="flex justify-between gap-3">
                <span>
                  {h.from_status ? `${m.quotes.statuses[h.from_status as QuoteStatus]} → ` : ""}
                  {m.quotes.statuses[h.to_status as QuoteStatus]}
                </span>
                <time className="tabular text-subtle">{formatDate(h.changed_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" })}</time>
              </li>
            ))}
            <li className="flex justify-between gap-3 text-muted">
              <span>{m.quotes.statuses.draft}</span>
              <time className="tabular text-subtle">{formatDate(quote.created_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" })}</time>
            </li>
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="mb-3 text-base font-semibold">{m.quotes.versions}</h2>
          {(versions ?? []).length === 0 ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.id} className="flex justify-between gap-3">
                  <span>{format(m.quotes.versionItem, { version: v.version })}</span>
                  <time className="tabular text-subtle">{formatDate(v.created_at, locale, scope.timezone, { dateStyle: "short", timeStyle: "short" })}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
