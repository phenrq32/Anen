import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@anen/i18n";
import { TransactionList } from "@/components/finance-ui";
import { Alert, Badge, Section } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope, loadFinanceBasics, sumByCurrency, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ArchiveContactButton, ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "Contacto" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const fin = financeScope(session);
  const t = m.business.contacts;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!scope.canRead) return <Alert tone="info">{t.noPermission}</Alert>;

  const { data: contact } = await session.supabase.from("contacts").select("*").eq("id", id).eq(scope.column, scope.value).maybeSingle();
  if (!contact) notFound();

  const [txRes, projectsRes, basics] = await Promise.all([
    fin.canRead
      ? session.supabase.from("transactions").select("*").eq("contact_id", id).order("occurred_on", { ascending: false }).limit(300)
      : Promise.resolve({ data: [], error: null }),
    session.supabase.from("projects").select("id, name, status").eq("client_contact_id", id).order("created_at", { ascending: false }),
    fin.canRead ? loadFinanceBasics(session.supabase, fin) : Promise.resolve(null),
  ]);
  const transactions = txRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const minorUnits = basics?.minorUnits ?? new Map<string, number>();
  const fmt = (v: bigint, c: string) => formatMoney(v, c, minorUnits.get(c) ?? 2, locale);

  const totals = [
    { label: t.sales, map: sumByCurrency(transactions.filter((x) => x.kind === "income").map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) }))) },
    { label: t.purchases, map: sumByCurrency(transactions.filter((x) => x.kind === "expense").map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) }))) },
    { label: t.openAmount, map: sumByCurrency(transactions.map((x) => ({ currency: x.currency_code, amount: BigInt(x.amount_minor) - BigInt(x.settled_minor) }))) },
  ];

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Link href="/contactos" className="text-sm text-muted hover:text-paper">← {t.title}</Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-[28px]">
            {contact.name}
            <Badge tone={contact.kind === "supplier" ? "neutral" : "brand"}>{t.kinds[contact.kind]}</Badge>
            {contact.archived_at ? <Badge>{t.archived}</Badge> : null}
          </h1>
          <p className="text-sm text-subtle">{[contact.tax_id, contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
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

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
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
                today={todayIn(fin.timezone)}
              />
            )
          ) : (
            <p className="text-sm text-muted">{m.finance.noPermission}</p>
          )}
        </Section>
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

      {scope.canWrite ? (
        <Section title={t.edit}>
          <ContactForm m={m} initial={contact} />
        </Section>
      ) : null}
    </>
  );
}
