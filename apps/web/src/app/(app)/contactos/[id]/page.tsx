import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type Decimal, decimalToString, summarizePriceHistory } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { ContactNote, SupplierPrice } from "@anen/types";
import { TransactionList } from "@/components/finance-ui";
import { Alert, Badge, Section } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope, loadFinanceBasics, sumByCurrency, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { quotesScope } from "@/lib/quotes";
import { requireOnboardedSession } from "@/lib/session";
import { ArchiveContactButton, ContactForm } from "../contact-form";
import { ContactNoteForm, DeleteNoteButton, DeletePriceButton, SupplierPriceForm, type ExpenseOption } from "../crm";

export const metadata: Metadata = { title: "Contacto" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const fin = financeScope(session);
  const qs = quotesScope(session);
  const t = m.business.contacts;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!scope.canRead) return <Alert tone="info">{t.noPermission}</Alert>;

  const { data: contact } = await session.supabase.from("contacts").select("*").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  if (!contact) notFound();
  const isClient = contact.kind !== "supplier";
  const isSupplier = contact.kind !== "client";

  const [txRes, projectsRes, basics, notesRes, quotesRes, pricesRes, currenciesRes] = await Promise.all([
    fin.canRead
      ? session.supabase.from("transactions").select("*").eq("contact_id", id).order("occurred_on", { ascending: false }).limit(300)
      : Promise.resolve({ data: [], error: null }),
    session.supabase.from("projects").select("id, name, status").eq("client_contact_id", id).order("created_at", { ascending: false }),
    fin.canRead ? loadFinanceBasics(session.supabase, fin) : Promise.resolve(null),
    session.supabase.from("contact_notes").select("*").eq("contact_id", id).order("noted_on", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    isClient && qs.canRead
      ? session.supabase.from("quotes").select("id, number, title, status, total_minor, currency_code").eq("client_contact_id", id).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    isSupplier
      ? session.supabase.from("supplier_prices").select("*").eq("contact_id", id).order("observed_on", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] as SupplierPrice[], error: null }),
    session.supabase.from("currencies").select("code, minor_unit, is_enabled").order("code"),
  ]);
  const transactions = txRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const notes: ContactNote[] = notesRes.data ?? [];
  const quotes = quotesRes.data ?? [];
  const prices: SupplierPrice[] = pricesRes.data ?? [];
  const currencies = currenciesRes.data ?? [];
  const minorUnits = basics?.minorUnits ?? new Map(currencies.map((c) => [c.code, c.minor_unit]));
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const pct = (d: Decimal) => {
    const n = Number(decimalToString(d));
    return `${n > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)} %`;
  };
  const today = todayIn(scope.timezone);

  const totals = [
    { label: t.sales, map: sumByCurrency(transactions.filter((x) => x.kind === "income").map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) }))) },
    { label: t.purchases, map: sumByCurrency(transactions.filter((x) => x.kind === "expense").map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) }))) },
    { label: t.openAmount, map: sumByCurrency(transactions.map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) - BigInt(x.settled_minor) }))) },
  ];
  // Pendentes: os que vencem primeiro no topo; sem vencimento no fim.
  const openItems = transactions
    .filter((x) => BigInt(x.settled_minor) < BigInt(x.amount_minor))
    .sort((a, b) => (a.due_on ?? "9999-12-31").localeCompare(b.due_on ?? "9999-12-31"));

  const series = summarizePriceHistory(
    prices.map((p) => ({
      id: p.id,
      itemName: p.item_name,
      unit: p.unit,
      unitPriceMinor: BigInt(p.unit_price_minor),
      currency: p.currency_code,
      observedOn: p.observed_on,
      createdAt: p.created_at,
    })),
  );
  const expenseOptions: ExpenseOption[] = transactions
    .filter((x) => x.kind === "expense")
    .slice(0, 100)
    .map((x) => ({
      id: x.id,
      currency: x.currency_code,
      label: `${day(x.occurred_on)} · ${x.description} · ${fmt(BigInt(x.amount_minor), x.currency_code)}`,
    }));

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link href="/contactos" className="text-sm text-muted hover:text-paper">← {t.title}</Link>
          <h1 className="flex flex-wrap items-center gap-3 break-words text-2xl font-bold sm:text-[28px]">
            {contact.name}
            <Badge tone={contact.kind === "supplier" ? "neutral" : "brand"}>{t.kinds[contact.kind]}</Badge>
            {contact.archived_at ? <Badge>{t.archived}</Badge> : null}
          </h1>
          <p className="break-words text-sm text-subtle">{[contact.tax_id, contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
        </div>
        {scope.canWrite ? <ArchiveContactButton m={m} id={contact.id} archived={Boolean(contact.archived_at)} /> : null}
      </header>

      {fin.canRead ? (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {totals.map((k) => (
            <div key={k.label} className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
              <span className="text-sm text-muted">{k.label}</span>
              {k.map.size === 0 ? (
                <span className="tabular text-xl font-semibold text-subtle">—</span>
              ) : (
                [...k.map].map(([c, v]) => (
                  <span key={c} className="tabular text-xl font-semibold">{fmt(v, c)}</span>
                ))
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title={t.timeline} description={t.timelineHint}>
          <div className="flex flex-col gap-6">
            {scope.canWrite ? <ContactNoteForm m={m} contactId={contact.id} today={today} /> : null}
            {notes.length === 0 ? (
              <p className="text-sm text-muted">{t.noNotes}</p>
            ) : (
              <ol className="flex flex-col" aria-label={t.timeline}>
                {notes.map((n) => (
                  <li key={n.id} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge>{t.noteKinds[n.kind]}</Badge>
                        <time dateTime={n.noted_on} className="text-muted">{day(n.noted_on)}</time>
                      </div>
                      <p className="whitespace-pre-line break-words text-[15px]">{n.body}</p>
                    </div>
                    {scope.canWrite ? <DeleteNoteButton m={m} id={n.id} /> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Section>

        <div className="flex min-w-0 flex-col gap-6">
          {fin.canRead ? (
            <Section title={t.openItems}>
              {openItems.length === 0 ? (
                <p className="text-sm text-muted">{t.noOpenItems}</p>
              ) : (
                <ul className="-my-2 flex flex-col" aria-label={t.openItems}>
                  {openItems.map((x) => {
                    const remaining = BigInt(x.amount_minor) - BigInt(x.settled_minor);
                    const overdue = x.due_on !== null && x.due_on < today;
                    return (
                      <li key={x.id} className="flex items-start justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate">{x.description}</span>
                          <span className={overdue ? "text-danger" : "text-subtle"}>
                            {x.due_on ? format(t.due, { date: day(x.due_on) }) : t.noDue}
                            {overdue ? ` · ${t.overdue}` : ""}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="tabular font-semibold">{fmt(remaining, x.currency_code)}</span>
                          <span className="text-xs text-subtle">{x.kind === "income" ? m.finance.tx.income : m.finance.tx.expense}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          ) : null}

          {isClient ? (
            <Section title={t.quotes}>
              {!qs.canRead ? (
                <p className="text-sm text-muted">{t.quotesNoPermission}</p>
              ) : quotes.length === 0 ? (
                <p className="text-sm text-muted">{t.noQuotes}</p>
              ) : (
                <ul className="-my-2 flex flex-col" aria-label={t.quotes}>
                  {quotes.map((q) => (
                    <li key={q.id} className="border-b border-line py-2.5 last:border-0">
                      <Link href={`/orcamentos/${q.id}`} className="flex items-start justify-between gap-3 text-sm hover:text-brand">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate">{q.title}</span>
                          <span className="text-subtle">{q.number} · {m.quotes.statuses[q.status]}</span>
                        </span>
                        <span className="tabular shrink-0 font-semibold">{fmt(BigInt(q.total_minor), q.currency_code)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          <Section title={t.projects}>
            {projects.length === 0 ? (
              <p className="text-sm text-muted">—</p>
            ) : (
              <ul className="-my-2 flex flex-col">
                {projects.map((p) => (
                  <li key={p.id} className="border-b border-line py-2.5 last:border-0">
                    <Link href={`/projetos/${p.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-brand">
                      <span className="truncate">{p.name}</span>
                      <Badge>{m.business.projects.statuses[p.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {isSupplier ? (
        <Section title={t.prices} description={t.pricesHint}>
          <div className="flex flex-col gap-6">
            {series.length === 0 ? (
              <p className="text-sm text-muted">{t.noPrices}</p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label={t.prices}>
                {series.map((s) => (
                  <li key={s.key} className="rounded-xl border border-line p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="break-words font-semibold">{s.itemName}{s.unit ? ` · ${s.unit}` : ""}</span>
                        <span className="text-sm text-subtle">{day(s.latestOn)} · {s.points.length} {t.records.toLowerCase()}</span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 sm:text-right">
                        <div className="flex flex-col">
                          <dt className="text-subtle">{t.latest}</dt>
                          <dd className="tabular font-semibold">{fmt(s.latest.amountMinor, s.currency)}</dd>
                        </div>
                        <div className="flex flex-col">
                          <dt className="text-subtle">{t.previous}</dt>
                          <dd className="tabular">{s.previous ? fmt(s.previous.amountMinor, s.currency) : "—"}</dd>
                        </div>
                        <div className="flex flex-col">
                          <dt className="text-subtle">{t.change}</dt>
                          <dd className={`tabular ${s.change && s.change.amountMinor > 0n ? "text-danger" : ""}`}>
                            {s.change ? `${s.change.amountMinor > 0n ? "+" : ""}${fmt(s.change.amountMinor, s.currency)}${s.changePercent ? ` (${pct(s.changePercent)})` : ""}` : t.firstRecord}
                          </dd>
                        </div>
                        <div className="flex flex-col">
                          <dt className="text-subtle">{t.range}</dt>
                          <dd className="tabular">{fmt(s.min.amountMinor, s.currency)} – {fmt(s.max.amountMinor, s.currency)}</dd>
                        </div>
                      </dl>
                    </div>
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-muted hover:text-paper">{format(t.historyOf, { item: s.itemName })}</summary>
                      <ul className="mt-2 flex flex-col">
                        {[...s.points].reverse().map((p) => {
                          const row = prices.find((x) => x.id === p.id);
                          return (
                            <li key={p.id} className="flex items-center justify-between gap-3 border-t border-line py-2">
                              <span className="flex min-w-0 flex-col">
                                <span>{day(p.observedOn)}</span>
                                {row?.notes ? <span className="break-words text-subtle">{row.notes}</span> : null}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="tabular">{fmt(p.unitPriceMinor, p.currency)}</span>
                                {scope.canWrite ? <DeletePriceButton m={m} id={p.id} /> : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {scope.canWrite ? (
              <SupplierPriceForm
                m={m}
                contactId={contact.id}
                today={today}
                currencies={currencies.filter((c) => c.is_enabled).map((c) => c.code)}
                defaultCurrency={scope.defaultCurrency}
                expenses={expenseOptions}
              />
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t.movements}>
        {basics ? (
          transactions.length === 0 ? (
            <p className="text-sm text-muted">{t.noMovements}</p>
          ) : (
            <TransactionList
              m={m}
              locale={locale}
              timeZone={fin.timezone}
              transactions={transactions}
              categories={new Map(basics.categories.map((c) => [c.id, c]))}
              accounts={new Map(basics.accounts.map((a) => [a.id, a]))}
              minorUnits={minorUnits}
              today={today}
            />
          )
        ) : (
          <p className="text-sm text-muted">{m.finance.noPermission}</p>
        )}
      </Section>

      {scope.canWrite ? (
        <Section title={t.edit}>
          <ContactForm m={m} initial={contact} />
        </Section>
      ) : null}
    </>
  );
}
