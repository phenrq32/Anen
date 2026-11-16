import type { Metadata } from "next";
import { computeMonthlyPlan, decimalToString } from "@anen/financial-engine";
import { format, formatDate, formatMoney } from "@anen/i18n";
import { formatAmountInput, monthParam } from "@anen/validation";
import type { InvestmentOption } from "@anen/types";
import { ProgressBar } from "@/components/finance-ui";
import { Alert, Badge, Section, cx } from "@/components/ui";
import { categoryLabel, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { AddFixedExpenseForm, FixedExpenseRow, PlanForm } from "./plan-forms";

export const metadata: Metadata = { title: "Plano do mês" };

export default async function MonthlyPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.finance.plan;
  if (session.active) return <Alert tone="info">{t.orgNote}</Alert>;

  const params = await searchParams;
  const today = todayIn(session.preferences.timezone);
  const month = params.mes && monthParam.safeParse(params.mes).success ? params.mes : today.slice(0, 7);
  const currency = session.preferences.currency_code;
  const userId = session.user.id;

  const [planRes, previousRes, fixedRes, categoriesRes, optionsRes, currencyRes] = await Promise.all([
    session.supabase.from("monthly_plans").select("*").eq("owner_user_id", userId).eq("month", `${month}-01`).maybeSingle(),
    session.supabase.from("monthly_plans").select("*").eq("owner_user_id", userId).lt("month", `${month}-01`).order("month", { ascending: false }).limit(1).maybeSingle(),
    session.supabase.from("fixed_expenses").select("*").eq("owner_user_id", userId).eq("is_active", true).order("position").order("created_at"),
    session.supabase
      .from("transaction_categories")
      .select("*")
      .eq("kind", "expense")
      .or(`is_system.eq.true,owner_user_id.eq.${userId}`)
      .is("archived_at", null)
      .order("is_system", { ascending: false })
      .order("name"),
    session.supabase.from("investment_options").select("*").eq("country_code", session.preferences.country_code ?? "").order("position"),
    session.supabase.from("currencies").select("minor_unit").eq("code", currency).maybeSingle(),
  ]);
  if (fixedRes.error) throw new Error("Falha ao carregar o plano");
  const minorUnit = currencyRes.data?.minor_unit ?? 2;
  const fmt = (v: bigint) => formatMoney(v, currency, minorUnit, locale);
  const pct = (d: Parameters<typeof decimalToString>[0] | null, digits = 0) =>
    d ? new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(decimalToString(d))) : "0";

  // Só as despesas fixas na moeda do plano entram nas contas (sem conversão entre moedas).
  const fixed = (fixedRes.data ?? []).filter((f) => f.currency_code === currency);
  const categories = new Map((categoriesRes.data ?? []).map((c) => [c.id, c]));
  const saved = planRes.data && planRes.data.currency_code === currency ? planRes.data : null;
  const basis = saved ?? (previousRes.data && previousRes.data.currency_code === currency ? previousRes.data : null);
  const salaryMinor = basis ? BigInt(basis.salary_minor) : null;
  const reserveMinor = basis ? BigInt(basis.emergency_reserve_minor) : 0n;
  const plan = salaryMinor !== null
    ? computeMonthlyPlan({ currency, salaryMinor, fixedExpensesMinor: fixed.map((f) => BigInt(f.amount_minor)), emergencyReserveMinor: reserveMinor })
    : null;

  const options = (optionsRes.data ?? []) as InvestmentOption[];
  const monthLabel = formatDate(`${month}-01`, locale, "UTC", { month: "long", year: "numeric" });
  const biggest = [...fixed].sort((a, b) => b.amount_minor - a.amount_minor).slice(0, 3);

  const optionList = (bucket: InvestmentOption["bucket"]) => {
    const list = options.filter((o) => o.bucket === bucket);
    if (list.length === 0) return <p className="text-sm text-subtle">{t.noOptions}</p>;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">{t.optionsFor}</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((o) => {
            const text = (t.options as Readonly<Record<string, { name: string; description: string }>>)[o.key];
            return (
              <li key={o.id} className="flex flex-col gap-2 rounded-lg border border-line bg-ink p-4">
                <p className="font-medium">{text?.name ?? o.key}</p>
                <p className="text-sm text-muted">{text?.description}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone={o.risk === "high" ? "danger" : "neutral"}>{`${t.risk}: ${t.risks[o.risk]}`}</Badge>
                  <Badge>{`${t.liquidity}: ${t.liquidities[o.liquidity]}`}</Badge>
                </div>
                <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                  {t.source}: {o.source_name} ↗
                </a>
                <p className="text-[11px] text-subtle">{format(t.reviewed, { date: formatDate(o.reviewed_on, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }) })}</p>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.intro}</p>

      <Section title={`${t.title} · ${monthLabel}`}>
        <form method="get" className="mb-5 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-subtle">
            {t.month}
            <input type="month" name="mes" defaultValue={month} className="h-10 rounded-md border border-line bg-ink px-3 text-sm text-paper" />
          </label>
          <button type="submit" className="h-10 rounded-md border border-line px-3 text-sm text-muted hover:text-paper">{m.finance.tx.filters.apply}</button>
        </form>
        {!saved && basis ? <p className="mb-4 text-sm text-subtle">{t.fromPrevious}</p> : null}
        <PlanForm
          key={month}
          m={m}
          month={month}
          currency={currency}
          salary={salaryMinor !== null ? formatAmountInput(salaryMinor, minorUnit) : ""}
          reserve={reserveMinor > 0n ? formatAmountInput(reserveMinor, minorUnit) : ""}
        />
      </Section>

      <Section title={t.fixedTitle} description={t.fixedHint}>
        <div className="flex flex-col gap-5">
          <AddFixedExpenseForm m={m} categories={(categoriesRes.data ?? []).map((c) => ({ id: c.id, label: categoryLabel(m, c) }))} />
          {fixed.length === 0 ? (
            <p className="text-sm text-muted">{t.fixedEmpty}</p>
          ) : (
            <ul className="flex flex-col">
              {fixed.map((f) => (
                <FixedExpenseRow
                  key={`${f.id}-${f.amount_minor}`}
                  m={m}
                  id={f.id}
                  name={f.name}
                  amount={formatAmountInput(BigInt(f.amount_minor), minorUnit)}
                  categoryLabel={f.category_id ? categoryLabel(m, categories.get(f.category_id)) : null}
                />
              ))}
            </ul>
          )}
        </div>
      </Section>

      {!plan ? (
        <Alert tone="info">{t.noSalary}</Alert>
      ) : (
        <>
          <section aria-labelledby="plan-summary" className="flex flex-col gap-3">
            <h2 id="plan-summary" className="sr-only">{t.summaryTitle}</h2>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
                <span className="text-sm text-muted">{t.salaryLabel}</span>
                <span className="tabular text-2xl font-semibold">{fmt(plan.salary.amountMinor)}</span>
              </div>
              <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
                <span className="text-sm text-muted">{t.fixedLabel}</span>
                <span className="tabular text-2xl font-semibold">{fmt(plan.fixedTotal.amountMinor)}</span>
                {plan.fixedPercentOfSalary ? <span className="text-xs text-subtle">{format(t.fixedShare, { percent: pct(plan.fixedPercentOfSalary) })}</span> : null}
              </div>
              <div className="flex flex-col gap-1.5 bg-surface p-4 sm:p-5">
                <span className="text-sm text-muted">{plan.status === "deficit" ? t.deficitLabel : t.surplusLabel}</span>
                <span className={cx("tabular text-2xl font-semibold", plan.status === "deficit" ? "text-danger" : plan.status === "surplus" ? "text-brand" : "")}>
                  {fmt(plan.status === "deficit" ? -plan.surplus.amountMinor : plan.surplus.amountMinor)}
                </span>
              </div>
            </div>
            {plan.salary.amountMinor > 0n ? (
              <ProgressBar value={plan.fixedTotal.amountMinor} max={plan.salary.amountMinor} over={plan.fixedAboveHalf} label={format(t.fixedShare, { percent: pct(plan.fixedPercentOfSalary) })} />
            ) : null}
            {plan.fixedAboveHalf && plan.status !== "deficit" ? <p className="text-sm text-muted">{t.fixedHigh}</p> : null}
          </section>

          {plan.status === "deficit" ? (
            <Section title={t.deficitTitle}>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">{format(t.deficitBody, { amount: fmt(-plan.surplus.amountMinor) })}</p>
                {biggest.length ? (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">{t.biggest}</p>
                    <ul className="flex flex-col">
                      {biggest.map((f) => (
                        <li key={f.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0">
                          <span>{f.name}</span>
                          <span className="tabular font-medium">{fmt(BigInt(f.amount_minor))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Section>
          ) : plan.status === "balanced" ? (
            <Section title={t.balancedTitle}>
              <p className="text-sm text-muted">{t.balancedBody}</p>
            </Section>
          ) : (
            <Section title={t.guidanceTitle} description={format(t.guidanceIntro, { amount: fmt(plan.surplus.amountMinor) })}>
              <div className="flex flex-col gap-8">
                {plan.surplusSize !== "none" ? (
                  <p className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-paper">{t.size[plan.surplusSize]}</p>
                ) : null}

                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">{t.step1Title}</h3>
                    <span className="tabular text-lg font-semibold text-brand">{fmt(plan.allocation.reserve.amountMinor)}</span>
                  </div>
                  {plan.reserve.complete ? (
                    <p className="text-sm text-muted">{t.reserveComplete}</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        {format(t.step1Body, {
                          amount: fmt(plan.allocation.reserve.amountMinor),
                          target: fmt(plan.reserve.target.amountMinor),
                          rule: plan.fixedTotal.amountMinor > 0n ? t.ruleFixed : t.ruleSalary,
                        })}
                        {plan.reserve.monthsCovered ? ` ${format(t.monthsCovered, { months: pct(plan.reserve.monthsCovered, 1) })}` : ""}
                        {plan.reserve.monthsToTarget ? ` ${format(t.monthsToTarget, { count: plan.reserve.monthsToTarget })}` : ""}
                      </p>
                      <ProgressBar value={plan.reserve.current.amountMinor} max={plan.reserve.target.amountMinor} label={t.step1Title} />
                      {optionList("reserve")}
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">{t.step2Title}</h3>
                    <span className="tabular text-lg font-semibold text-brand">{fmt(plan.allocation.longTerm.amountMinor)}</span>
                  </div>
                  {plan.allocation.longTerm.amountMinor === 0n ? (
                    <p className="text-sm text-muted">{t.noLongTerm}</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">{format(t.step2Body, { amount: fmt(plan.allocation.longTerm.amountMinor) })}</p>
                      {plan.surplusSize === "small" ? <p className="text-sm text-muted">{t.step2Small}</p> : null}
                      {optionList("long_term")}
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
                  <p className="text-sm font-medium">{format(t.projectionTitle, { amount: fmt(plan.surplus.amountMinor) })}</p>
                  <dl className="grid grid-cols-3 gap-3">
                    {([
                      [t.projection12, plan.projection.months12],
                      [t.projection60, plan.projection.months60],
                      [t.projection120, plan.projection.months120],
                    ] as const).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-subtle">{label}</dt>
                        <dd className="tabular text-base font-semibold sm:text-lg">{fmt(value.amountMinor)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-subtle">{t.projectionNote}</p>
                </div>
              </div>
            </Section>
          )}

          <details className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-muted sm:px-6">
            <summary className="cursor-pointer font-medium text-paper">{t.howTitle}</summary>
            <p className="mt-2 max-w-3xl">{t.howBody}</p>
          </details>
          <p className="text-xs text-subtle">{t.disclaimer}</p>
        </>
      )}
    </div>
  );
}
