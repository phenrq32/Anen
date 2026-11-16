"use client";

import { useMemo, useState } from "react";
import { computeQuote, decimalToString, type QuoteBreakdown } from "@anen/financial-engine";
import { formatMoney, type Messages } from "@anen/i18n";
import type { Locale, QuoteItemKind } from "@anen/types";
import { parseAmountInput, parsePercentInput, parseQuantityInput, QUOTE_ITEM_KINDS } from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, cx } from "@/components/ui";
import { saveQuoteAction } from "./actions";

export interface EditorLine {
  key: string;
  kind: QuoteItemKind;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
}

export interface EditorQuote {
  id: string;
  title: string;
  description: string;
  clientName: string;
  clientEmail: string;
  clientTaxId: string;
  clientAddress: string;
  validUntil: string;
  margin: string;
  taxRate: string;
  taxLabel: string;
  conditions: string;
  currency: string;
}

let counter = 0;
const newKey = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

export function QuoteEditor({
  m,
  locale,
  quote,
  initialLines,
  minorUnit,
  readOnly,
}: {
  m: Messages;
  locale: Locale;
  quote: EditorQuote;
  initialLines: EditorLine[];
  minorUnit: number;
  readOnly: boolean;
}) {
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [margin, setMargin] = useState(quote.margin);
  const [taxRate, setTaxRate] = useState(quote.taxRate);
  const fmt = (v: bigint) => formatMoney(v, quote.currency, minorUnit, locale);

  const preview = useMemo((): { breakdown: QuoteBreakdown | null; invalid: Set<string> } => {
    const invalid = new Set<string>();
    const parsed = lines.map((l) => {
      const quantity = parseQuantityInput(l.quantity);
      const cost = parseAmountInput(l.unitCost || "0", minorUnit);
      if (quantity === null || cost === null) invalid.add(l.key);
      return { kind: l.kind, quantity: quantity ?? "0", unitCostMinor: cost ?? 0n };
    });
    const mp = parsePercentInput(margin, { exclusiveMax: true });
    const tp = parsePercentInput(taxRate);
    if (mp === null) invalid.add("margin");
    if (tp === null) invalid.add("taxRate");
    if (invalid.size) return { breakdown: null, invalid };
    try {
      return { breakdown: computeQuote({ currency: quote.currency, lines: parsed, marginPercent: mp!, taxRatePercent: tp! }), invalid };
    } catch {
      return { breakdown: null, invalid };
    }
  }, [lines, margin, taxRate, minorUnit, quote.currency]);

  const update = (key: string, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const b = preview.breakdown;
  const cellInput =
    "h-10 w-full min-w-0 rounded-md border border-line bg-ink px-2.5 text-sm text-paper focus:border-brand focus:outline-none disabled:opacity-70 aria-[invalid=true]:border-danger";

  return (
    <ActionForm action={saveQuoteAction} className="gap-6">
      {(state) => (
        <fieldset disabled={readOnly} className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <input type="hidden" name="id" value={quote.id} />
          <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ key: _key, ...rest }) => rest))} />
          <div className="flex min-w-0 flex-col gap-6">
            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="text-base font-semibold">{m.quotes.sections.details}</h2>
              <Field name="title" label={m.quotes.fields.title} defaultValue={quote.title} required maxLength={160} error={state.fieldErrors?.title} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="q-description" className="text-sm font-medium">{m.quotes.fields.description}</label>
                <textarea
                  id="q-description"
                  name="description"
                  defaultValue={quote.description}
                  maxLength={4000}
                  rows={3}
                  className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-paper focus:border-brand focus:outline-none"
                />
              </div>
              <h3 className="pt-2 text-sm font-semibold text-muted">{m.quotes.sections.client}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="clientName" label={m.quotes.fields.clientName} defaultValue={quote.clientName} maxLength={160} />
                <Field name="clientEmail" type="email" label={m.quotes.fields.clientEmail} defaultValue={quote.clientEmail} error={state.fieldErrors?.clientEmail} />
                <Field name="clientTaxId" label={m.quotes.fields.clientTaxId} defaultValue={quote.clientTaxId} maxLength={32} />
                <Field name="validUntil" type="date" label={m.quotes.fields.validUntil} defaultValue={quote.validUntil} />
              </div>
              <Field name="clientAddress" label={m.quotes.fields.clientAddress} defaultValue={quote.clientAddress} maxLength={400} />
            </section>

            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="text-base font-semibold">{m.quotes.sections.lines}</h2>
              <div className="hidden grid-cols-[150px_1fr_80px_70px_110px_110px_36px] gap-2 text-xs text-subtle md:grid">
                <span>{m.quotes.line.kind}</span>
                <span>{m.quotes.line.description}</span>
                <span>{m.quotes.line.quantity}</span>
                <span>{m.quotes.line.unit}</span>
                <span>{m.quotes.line.unitCost}</span>
                <span className="text-right">{m.quotes.line.total}</span>
                <span />
              </div>
              <ul className="flex flex-col gap-3 md:gap-2">
                {lines.map((l, i) => {
                  const bad = preview.invalid.has(l.key);
                  const total = b?.lineTotals[i];
                  return (
                    <li
                      key={l.key}
                      className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 md:grid-cols-[150px_1fr_80px_70px_110px_110px_36px] md:items-center md:border-0 md:p-0 animate-[rise-in_200ms_ease-out]"
                    >
                      <select aria-label={m.quotes.line.kind} value={l.kind} onChange={(e) => update(l.key, { kind: e.target.value as QuoteItemKind })} className={cellInput}>
                        {QUOTE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>{m.quotes.line.kinds[k]}</option>
                        ))}
                      </select>
                      <input aria-label={m.quotes.line.description} value={l.description} maxLength={300} onChange={(e) => update(l.key, { description: e.target.value })} className={cx(cellInput, "col-span-2 md:col-span-1 max-md:order-first")} />
                      <input aria-label={m.quotes.line.quantity} inputMode="decimal" value={l.quantity} aria-invalid={bad && parseQuantityInput(l.quantity) === null} onChange={(e) => update(l.key, { quantity: e.target.value })} className={cx(cellInput, "tabular text-right")} />
                      <input aria-label={m.quotes.line.unit} value={l.unit} maxLength={20} onChange={(e) => update(l.key, { unit: e.target.value })} className={cellInput} />
                      <input aria-label={m.quotes.line.unitCost} inputMode="decimal" value={l.unitCost} placeholder="0,00" aria-invalid={bad && parseAmountInput(l.unitCost || "0", minorUnit) === null} onChange={(e) => update(l.key, { unitCost: e.target.value })} className={cx(cellInput, "tabular text-right")} />
                      <span className="tabular self-center text-right text-sm font-medium">{total ? fmt(total.amountMinor) : "—"}</span>
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        className="grid size-9 place-items-center justify-self-end rounded-md text-subtle hover:bg-graphite hover:text-danger"
                        aria-label={`${m.quotes.line.remove} ${i + 1}`}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  {(["material", "labor", "travel", "equipment", "overhead"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLines((ls) => [...ls, { key: newKey(), kind: k, description: m.quotes.line.kinds[k], quantity: "1", unit: k === "labor" ? "h" : k === "travel" ? "km" : "un", unitCost: "" }])}
                      className="h-9 rounded-full border border-line px-3 text-sm text-muted transition-colors hover:border-brand hover:text-paper"
                    >
                      + {m.quotes.line.kinds[k]}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="text-base font-semibold">{m.quotes.sections.conditions}</h2>
              <textarea
                name="conditions"
                aria-label={m.quotes.fields.conditions}
                defaultValue={quote.conditions}
                maxLength={4000}
                rows={4}
                className="w-full rounded-md border border-line bg-ink px-3.5 py-2.5 text-[15px] text-paper focus:border-brand focus:outline-none"
              />
            </section>
          </div>

          <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-base font-semibold">{m.quotes.sections.pricing}</h2>
              <Field name="margin" label={m.quotes.fields.margin} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} hint={m.quotes.fields.marginHint} error={state.fieldErrors?.margin} className="tabular" />
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field name="taxLabel" label={m.quotes.fields.taxLabel} defaultValue={quote.taxLabel} maxLength={60} placeholder="IVA" />
                <Field name="taxRate" label="%" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} error={state.fieldErrors?.taxRate} className="tabular" />
              </div>
              <p className="text-xs text-subtle">{m.quotes.fields.taxHint}</p>
              {b ? (
                <dl className="flex flex-col gap-2 border-t border-line pt-4 text-sm" aria-live="polite">
                  <Row label={m.quotes.summary.direct} value={fmt(b.directCost.amountMinor)} />
                  <Row label={m.quotes.summary.overhead} value={fmt(b.overheadCost.amountMinor)} />
                  <Row label={m.quotes.summary.cost} value={fmt(b.totalCost.amountMinor)} strong />
                  <Row label={m.quotes.summary.profit} value={fmt(b.profit.amountMinor)} accent />
                  <Row
                    label={`${m.quotes.summary.margin} / ${m.quotes.summary.markup}`}
                    value={`${b.effectiveMarginPercent ? decimalToString(b.effectiveMarginPercent).replace(".", ",") : "—"} % / ${b.effectiveMarkupPercent ? decimalToString(b.effectiveMarkupPercent).replace(".", ",") : "—"} %`}
                  />
                  <Row label={m.quotes.summary.price} value={fmt(b.priceBeforeTax.amountMinor)} />
                  <Row label={m.quotes.summary.tax} value={fmt(b.tax.amountMinor)} />
                  <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                    <dt className="font-medium">{m.quotes.summary.total}</dt>
                    <dd className="tabular text-2xl font-bold text-brand">{fmt(b.total.amountMinor)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="border-t border-line pt-4 text-sm text-danger">{m.quotes.summary.invalid}</p>
              )}
              {readOnly ? null : (
                <SubmitButton pendingLabel={m.common.saving} className="w-full">
                  {m.quotes.save}
                </SubmitButton>
              )}
            </section>
          </aside>
        </fieldset>
      )}
    </ActionForm>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("tabular text-right", strong && "font-semibold", accent && "text-brand")}>{value}</dd>
    </div>
  );
}
