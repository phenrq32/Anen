import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, PageHeader, Section, cx } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Clientes e fornecedores" };

const KINDS = ["client", "supplier"] as const;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = businessScope(session);
  const t = m.business.contacts;
  if (!scope.canRead) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const kind = params.tipo === "client" || params.tipo === "supplier" ? params.tipo : "";
  const showArchived = params.arquivados === "1";
  const search = (params.q ?? "").slice(0, 80);

  let query = session.supabase.from("contacts").select("*").eq(scope.column, scope.value).order("name").limit(500);
  if (kind) query = query.in("kind", [kind, "both"]);
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (search) query = query.ilike("name", `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await query;
  if (error) throw new Error("Falha ao carregar contactos");
  const contacts = data ?? [];

  const filterHref = (k: string) => {
    const p = new URLSearchParams({ ...(k ? { tipo: k } : {}), ...(search ? { q: search } : {}) });
    return `/contactos${p.size ? `?${p}` : ""}`;
  };
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {!scope.canWrite ? <Alert tone="info">{t.readOnly}</Alert> : null}
      {scope.canWrite ? (
        <Section title={t.new}>
          <ContactForm m={m} defaultKind={kind === "supplier" ? "supplier" : "client"} />
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={filterHref("")} className={chip(!kind && !showArchived)}>{t.all}</Link>
        {KINDS.map((k) => (
          <Link key={k} href={filterHref(k)} className={chip(kind === k && !showArchived)}>
            {t.kinds[k]}
          </Link>
        ))}
        <Link href="/contactos?arquivados=1" className={chip(showArchived)}>{t.archived}</Link>
        <form method="get" role="search" className="ml-auto flex min-w-48 flex-1 sm:flex-none">
          {kind ? <input type="hidden" name="tipo" value={kind} /> : null}
          <label htmlFor="contact-search" className="sr-only">{m.finance.tx.filters.search}</label>
          <input
            id="contact-search"
            type="search"
            name="q"
            defaultValue={search}
            placeholder={m.finance.tx.filters.search}
            className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-paper focus:border-brand focus:outline-none"
          />
        </form>
      </div>

      <section className="rounded-xl border border-line bg-surface">
        {contacts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">{t.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {contacts.map((c) => (
              <li key={c.id} className="border-b border-line last:border-0">
                <Link href={`/contactos/${c.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-graphite/50 sm:px-6">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-graphite text-sm font-semibold text-muted" aria-hidden>
                    {c.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-subtle">
                      {[c.tax_id, c.email, c.phone].filter(Boolean).join(" · ") || " "}
                    </span>
                  </span>
                  <Badge tone={c.kind === "supplier" ? "neutral" : "brand"}>{t.kinds[c.kind]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
