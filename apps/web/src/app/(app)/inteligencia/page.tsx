import type { Metadata } from "next";
import Link from "next/link";
import { type Decimal, type Money, type Recommendation } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import type { AiDigest, AiDigestKind, AiStatus } from "@anen/types";
import { AiText } from "@/components/ai-text";
import { Alert, Badge, PageHeader, Section, buttonClass, cx } from "@/components/ui";
import { geminiConfig } from "@/lib/ai/gemini";
import { getI18n } from "@/lib/i18n";
import { loadIntelligence, parseDigestKind } from "@/lib/intelligence";
import { formatPercent } from "@/lib/projects";
import { requireOnboardedSession } from "@/lib/session";
import { DigestForm } from "./digest-form";

export const metadata: Metadata = { title: "Inteligência" };
// Gerar o resumo pode levar várias chamadas ao modelo e às ferramentas.
export const maxDuration = 120;

const KINDS: AiDigestKind[] = ["week", "month"];

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.intelligence;
  const kind = parseDigestKind((await searchParams).periodo);
  const orgId = session.active?.organization.id ?? null;
  const data = await loadIntelligence(session, m, kind);

  const units = (c: string) => data.minorUnits.get(c) ?? 2;
  const money = (v: Money) => formatMoney(v.amountMinor, v.currency, units(v.currency), locale);
  const fmt = (v: bigint, c: string) => formatMoney(v, c, units(c), locale);
  const day = (d: string) => formatDate(d, locale, "UTC", { day: "2-digit", month: "short" });
  const pct = (d: Decimal | null | undefined) => {
    if (!d) return "";
    const abs: Decimal = d.coefficient < 0n ? { ...d, coefficient: -d.coefficient } : d;
    return formatPercent(abs, locale) ?? "";
  };
  const subjectOf = (r: Recommendation) =>
    r.kind === "expense_increase" ? (r.subject ? (data.categoryNames.get(r.subject) ?? m.reports.none.category) : m.reports.none.category) : (r.subject ?? "");
  const vars = (r: Recommendation) => ({
    impact: r.impact ? money(r.impact) : "",
    count: r.count,
    subject: subjectOf(r),
    percent: pct(r.percent),
    before: r.before ? money(r.before) : "",
    after: r.after ? money(r.after) : "",
  });

  // ANEN AI: estado do plano e resumo guardado para este período.
  const aiConfigured = Boolean(geminiConfig());
  let status: AiStatus | undefined;
  let digest: AiDigest | null = null;
  if (aiConfigured) {
    let dq = session.supabase.from("ai_digests").select("*").eq("period_kind", kind).eq("period_to", data.current.to).eq("user_id", session.user.id);
    dq = orgId ? dq.eq("organization_id", orgId) : dq.is("organization_id", null);
    const [s, d] = await Promise.all([session.supabase.rpc("ai_status", { p_org: orgId }), dq.maybeSingle()]);
    status = s.data?.[0];
    digest = d.data ?? null;
  }

  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");
  const levelTone = (l: Recommendation["severity"]) => (l === "high" ? "danger" : l === "medium" ? "brand" : "neutral");

  return (
    <>
      <PageHeader title={t.title} description={t.description} />

      <section aria-label={t.periodChoice} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((k) => (
            <Link key={k} href={`/inteligencia?periodo=${k}`} className={chip(k === kind)} aria-current={k === kind ? "page" : undefined}>
              {t.periods[k]}
            </Link>
          ))}
        </div>
        <p className="text-sm text-subtle">
          {format(t.periodLabel, { from: day(data.current.from), to: day(data.current.to), pfrom: day(data.previous.from), pto: day(data.previous.to) })}
        </p>
      </section>

      {!data.canFinance ? <Alert tone="info">{t.noFinance}</Alert> : null}
      {!data.canBusiness ? <Alert tone="info">{t.noBusiness}</Alert> : null}

      {data.canFinance && data.totals.current.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.totals.current.flatMap((cur) => {
            const prev = data.totals.previous.find((p) => p.currency === cur.currency);
            const cells = [
              { label: t.income, v: cur.income, p: prev?.income ?? 0n },
              { label: t.expense, v: cur.expense, p: prev?.expense ?? 0n },
              { label: t.result, v: cur.income - cur.expense, p: prev ? prev.income - prev.expense : 0n, signed: true },
            ];
            return cells.map((c) => (
              <div key={`${cur.currency}-${c.label}`} className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-4">
                <span className="text-xs uppercase tracking-wider text-subtle">{c.label}</span>
                <span className={cx("tabular text-xl font-semibold", c.signed && c.v < 0n ? "text-danger" : "")}>{fmt(c.v, cur.currency)}</span>
                <span className="tabular text-xs text-subtle">{format(t.previous, { value: fmt(c.p, cur.currency) })}</span>
              </div>
            ));
          })}
        </div>
      ) : null}

      <Section title={t.recommendations} description={t.howItWorks}>
        {data.recommendations.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-5 text-sm text-muted">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t.recommendations}>
            {data.recommendations.map((r, i) => {
              const k = t.kinds[r.kind];
              const v = vars(r);
              return (
                <li key={`${r.kind}-${i}`} data-kind={r.kind} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={levelTone(r.severity)}>{t.severity[r.severity]}</Badge>
                    <span className="text-xs text-subtle">{format(t.confidence, { level: t.levels[r.confidence] })}</span>
                  </div>
                  <h3 className="break-words font-semibold">{format(k.title, v)}</h3>
                  <p className="break-words text-[15px] text-muted">{format(k.body, v)}</p>
                  <div>
                    <Link href={r.href} className={buttonClass("secondary", "h-9 px-3")}>{k.action}</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t.digest.title} description={t.digest.description}>
        {!aiConfigured || !status ? (
          <Alert tone="info">{t.digest.notConfigured}</Alert>
        ) : status.daily_limit <= 0 ? (
          <Alert tone="info">{t.digest.locked}</Alert>
        ) : !status.consented ? (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="info">{t.digest.consent}</Alert>
            <Link href="/ia" className={buttonClass("secondary")}>{t.digest.openAi}</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {digest ? (
              <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-4 sm:px-5" aria-label={t.digest.title}>
                <AiText text={digest.content} />
                {digest.sources.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                    <span className="text-subtle">{m.ai.sources}:</span>
                    {digest.sources.map((s) => (
                      <Link key={s.href} href={s.href} className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-brand/40 hover:text-paper">
                        {s.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-subtle">
                  {format(t.digest.generatedAt, {
                    date: formatDate(digest.created_at, locale, session.preferences.timezone, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
                  })}
                </p>
              </article>
            ) : null}
            {status.used_today >= status.daily_limit ? <Alert tone="info">{m.errors.ai_daily_limit}</Alert> : null}
            <DigestForm m={m} kind={kind} hasDigest={Boolean(digest)} disabled={status.used_today >= status.daily_limit} />
          </div>
        )}
      </Section>
    </>
  );
}
