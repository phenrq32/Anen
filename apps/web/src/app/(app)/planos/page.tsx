import type { Metadata } from "next";
import Link from "next/link";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { Alert, Badge, PageHeader, cx } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { infinitePayHandle } from "@/lib/infinitepay";
import { can, requireOnboardedSession } from "@/lib/session";
import { BuyButton } from "./buy-button";

export const metadata: Metadata = { title: "Planos" };

type Market = "BRL" | "EUR";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ moeda?: string; periodo?: string }> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const sp = await searchParams;
  const t = m.billing;
  const prefs = session.preferences;
  const defaultMarket: Market = prefs.currency_code === "BRL" || prefs.country_code === "BR" ? "BRL" : "EUR";
  const market: Market = sp.moeda === "BRL" || sp.moeda === "EUR" ? sp.moeda : defaultMarket;
  const months = sp.periodo === "anual" ? 12 : 1;
  const org = session.active?.organization.id ?? null;

  const [{ data: prices }, { data: plans }, { data: subs }] = await Promise.all([
    session.supabase.from("plan_prices").select("plan_key, currency_code, months, price_minor, valid_from").lte("valid_from", new Date().toISOString().slice(0, 10)).order("valid_from", { ascending: false }),
    session.supabase.from("plans").select("key, name, ai_daily_limit").order("position"),
    org
      ? session.supabase.from("subscriptions").select("plan_key, current_period_end, source").eq("organization_id", org).eq("status", "active")
      : session.supabase.from("subscriptions").select("plan_key, current_period_end, source").eq("owner_user_id", session.user.id).eq("status", "active"),
  ]);
  const price = (plan: string, mo: number) => prices?.find((p) => p.plan_key === plan && p.currency_code === market && p.months === mo)?.price_minor ?? null;
  const active = subs?.find((s) => !s.current_period_end || Date.parse(s.current_period_end) > Date.now());
  const currentKey = active?.plan_key ?? "free";
  const canBuy = !session.active || can(session.active, "organization.update");
  const brazilReady = market === "BRL" && Boolean(infinitePayHandle());
  const money = (minor: number) => formatMoney(BigInt(minor), market, 2, locale);
  const chip = (on: boolean) => cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", on ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");
  const href = (next: { moeda?: Market; periodo?: string }) => {
    const q = new URLSearchParams({ moeda: next.moeda ?? market, periodo: next.periodo ?? (months === 12 ? "anual" : "mensal") });
    return `/planos?${q.toString()}`;
  };

  const cards = (plans ?? []).map((p) => {
    const key = p.key as "free" | "pro" | "max";
    const monthly = key === "free" ? 0 : price(key, 1);
    const value = key === "free" ? 0 : price(key, months);
    return { key, name: p.name, limit: p.ai_daily_limit, value, monthly };
  });

  return (
    <>
      <PageHeader title={t.title} description={session.active ? format(t.descriptionOrg, { organization: session.active.organization.name }) : t.description} />
      {active && active.plan_key !== "free" ? (
        <Alert tone="info">
          {active.current_period_end
            ? format(t.currentUntil, { plan: cards.find((c) => c.key === active.plan_key)?.name ?? active.plan_key, date: formatDate(active.current_period_end, locale, session.preferences.timezone, { day: "numeric", month: "long", year: "numeric" }) })
            : format(t.currentUnlimited, { plan: cards.find((c) => c.key === active.plan_key)?.name ?? active.plan_key })}
        </Alert>
      ) : null}
      {!canBuy ? <Alert tone="info">{t.orgOwnersOnly}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ periodo: "mensal" })} className={chip(months === 1)} aria-current={months === 1 ? "page" : undefined}>{t.monthly}</Link>
        <Link href={href({ periodo: "anual" })} className={chip(months === 12)} aria-current={months === 12 ? "page" : undefined}>
          {t.yearly} <span className="ml-1.5 text-xs text-brand">{t.yearlyBadge}</span>
        </Link>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Link href={href({ moeda: "BRL" })} className={chip(market === "BRL")}>{t.brazil}</Link>
        <Link href={href({ moeda: "EUR" })} className={chip(market === "EUR")}>{t.portugal}</Link>
      </div>

      <div className="stagger grid gap-4 md:grid-cols-3">
        {cards.map((c) => {
          const highlight = c.key === "max";
          const isCurrent = c.key === currentKey;
          return (
            <section
              key={c.key}
              className={cx("glass spot lift flex flex-col gap-4 rounded-3xl border p-6", highlight && "border-brand/50 shadow-[0_20px_60px_-30px_rgba(255,133,27,0.6)]")}
              aria-labelledby={`plano-${c.key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id={`plano-${c.key}`} className="font-heading text-xl font-bold">{c.name}</h2>
                {isCurrent ? <Badge tone="brand">{t.current}</Badge> : highlight ? <Badge tone="brand">{t.popular}</Badge> : null}
              </div>
              <div className="flex flex-col">
                <span className="tabular font-heading text-3xl font-extrabold">{c.value === null ? "—" : money(c.value)}</span>
                <span className="text-sm text-subtle">
                  {c.key === "free" ? t.forever : months === 12 ? format(t.perYear, { monthly: c.value ? money(Math.round(c.value / 12)) : "" }) : t.perMonth}
                </span>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-muted">
                {t.features[c.key].map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-brand" aria-hidden>✓</span>
                    {f}
                  </li>
                ))}
                {c.limit > 0 ? (
                  <li className="flex gap-2">
                    <span className="text-brand" aria-hidden>✓</span>
                    {format(t.aiLimit, { count: c.limit })}
                  </li>
                ) : null}
              </ul>
              {c.key === "free" ? null : !canBuy ? null : market === "EUR" ? (
                <p className="rounded-xl border border-line px-3 py-2 text-sm text-muted">{t.portugalSoon}</p>
              ) : !brazilReady ? (
                <p className="rounded-xl border border-line px-3 py-2 text-sm text-muted">{t.unavailable}</p>
              ) : (
                <BuyButton
                  m={m}
                  plan={c.key}
                  months={months}
                  label={isCurrent ? t.renew : currentKey === "max" && c.key === "pro" ? t.switchDown : format(t.subscribe, { plan: c.name })}
                  {...(currentKey === "max" && c.key === "pro" ? { confirmMessage: t.downgradeWarning } : {})}
                />
              )}
            </section>
          );
        })}
      </div>
      <p className="text-xs text-subtle">{market === "BRL" ? t.brazilNote : t.portugalNote}</p>
    </>
  );
}
