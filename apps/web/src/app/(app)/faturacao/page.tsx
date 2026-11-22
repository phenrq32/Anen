import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { FiscalDocument, FiscalDocumentKind } from "@anen/types";
import { Alert, Badge, ButtonLink, PageHeader, Section, cx } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { encryptionConfigured } from "@/lib/invoicing/crypto";
import { loadInvoicing } from "@/lib/invoicing/service";
import { requireOnboardedSession } from "@/lib/session";
import { ConnectForm, DisconnectButton, LoadAddressForm, RefreshSettingsButton } from "./invoicing-forms";
import { statusTone } from "./status";

export const metadata: Metadata = { title: "Faturação" };

const KINDS: FiscalDocumentKind[] = ["invoice", "invoice_receipt", "simplified_invoice", "credit_note", "transport", "shipping"];

export default async function InvoicingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.invoicing;
  const { fin, connection } = await loadInvoicing(session);
  if (!fin.canRead) {
    return (
      <>
        <PageHeader title={t.title} />
        <Alert tone="info">{t.noPermission}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const kind = KINDS.find((k) => k === params.tipo) ?? null;
  const country = session.active?.organization.country_code ?? session.preferences.country_code;

  let q = session.supabase.from("fiscal_documents").select("*").eq(fin.column, fin.value).order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  const docs: FiscalDocument[] = data ?? [];
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" });
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={connection && fin.canWrite ? <ButtonLink href="/faturacao/novo">{t.new}</ButtonLink> : undefined}
      />
      {country && country !== "PT" ? <Alert tone="info">{t.onlyPortugal}</Alert> : null}
      <p className="max-w-3xl text-xs text-subtle">{t.legal}</p>
      {!encryptionConfigured() ? <Alert tone="info">{t.notConfigured}</Alert> : null}
      {!fin.canWrite ? <Alert tone="info">{t.readOnly}</Alert> : null}

      {!connection ? (
        fin.canWrite && encryptionConfigured() ? (
          <Section title={t.connect.title} description={t.connect.steps}>
            <ConnectForm m={m} />
          </Section>
        ) : null
      ) : (
        <Section
          title="InvoiceXpress"
          description={format(t.connection, { account: connection.account_name, hint: connection.api_key_hint, date: day(connection.verified_at.slice(0, 10)) })}
        >
          <div className="flex flex-col gap-5">
            {connection.taxes.length > 0 ? (
              <p className="text-sm text-muted">
                {t.taxes}: {connection.taxes.map((x) => `${x.name} (${Number(x.value)} %)`).join(" · ")}
              </p>
            ) : null}
            {fin.canWrite ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <RefreshSettingsButton m={m} />
                  <DisconnectButton m={m} />
                </div>
                <details className="rounded-lg border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">{t.loadAddress.title}</summary>
                  <p className="mt-2 text-sm text-muted">{t.loadAddress.description}</p>
                  <div className="mt-4"><LoadAddressForm m={m} address={connection.load_address} /></div>
                </details>
                <details className="rounded-lg border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">{t.connect.reconnect}</summary>
                  <div className="mt-4"><ConnectForm m={m} accountName={connection.account_name} reconnect /></div>
                </details>
              </>
            ) : null}
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/faturacao" className={chip(!kind)}>{t.all}</Link>
        {KINDS.map((k) => (
          <Link key={k} href={`/faturacao?tipo=${k}`} className={chip(kind === k)}>{t.kinds[k]}</Link>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-surface">
        {docs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">{t.empty}</p>
        ) : (
          <ul className="flex flex-col" aria-label={t.title}>
            {docs.map((d) => (
              <li key={d.id} className="border-b border-line last:border-0">
                <Link href={`/faturacao/${d.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-graphite/50 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {t.kinds[d.kind]} {d.sequence_number ?? ""}
                    </span>
                    <span className="block truncate text-xs text-subtle">{d.client_name} · {day(d.issue_date)}</span>
                  </span>
                  <Badge tone={statusTone(d.status)}>{t.statuses[d.status]}</Badge>
                  <span className="tabular w-28 shrink-0 text-right text-sm font-semibold">
                    {d.total_minor !== null ? formatMoney(BigInt(d.total_minor), d.currency_code, 2, locale) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
