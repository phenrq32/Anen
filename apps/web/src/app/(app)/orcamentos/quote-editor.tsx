"use client";

import { useMemo, useState } from "react";
import { QuoteDiscountTooLargeError, computeQuote, decimalToString, defaultNature, type QuoteBreakdown } from "@anen/financial-engine";
import { formatMoney, type Messages } from "@anen/i18n";
import type { Locale, QuoteItemKind, QuoteItemNature } from "@anen/types";
import {
  parseAmountInput,
  parsePercentInput,
  parseQuantityInput,
  parseQuoteDiscount,
  QUOTE_DISCOUNT_TYPES,
  QUOTE_ITEM_KINDS,
  QUOTE_ITEM_NATURES,
} from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, SelectField, cx } from "@/components/ui";
import { saveQuoteAction } from "./actions";

export interface EditorLine {
  key: string;
  kind: QuoteItemKind;
  nature: QuoteItemNature;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
}

export interface EditorQuote {
  id: string;
  title: string;
  description: string;
  clientContactId: string;
  clientName: string;
  clientEmail: string;
  clientTaxId: string;
  clientAddress: string;
  validUntil: string;
  margin: string;
  taxRate: string;
  taxLabel: string;
  discountType: (typeof QUOTE_DISCOUNT_TYPES)[number];
  discountValue: string;
  conditions: string;
  currency: string;
}

export interface EditorClient {
  id: string;
  name: string;
  email: string;
  taxId: string;
  address: string;
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
  clients,
}: {
  m: Messages;
  locale: Locale;
  quote: EditorQuote;
  initialLines: EditorLine[];
  minorUnit: number;
  readOnly: boolean;
  /** null: sem permissão para ver o cadastro; a ligação existente mantém-se. */
  clients: EditorClient[] | null;
}) {
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [margin, setMargin] = useState(quote.margin);
  const [taxRate, setTaxRate] = useState(quote.taxRate);
  const [discountType, setDiscountType] = useState(quote.discountType);
  const [discountValue, setDiscountValue] = useState(quote.discountValue);
  const fmt = (v: bigint) => formatMoney(v, quote.currency, minorUnit, locale);

  const preview = useMemo((): { breakdown: QuoteBreakdown | null; invalid: Set<string> } => {
    const invalid = new Set<string>();
    const parsed = lines.map((l) => {
      const quantity = parseQuantityInput(l.quantity);
      const cost = parseAmountInput(l.unitCost || "0", minorUnit);
      if (quantity === null || cost === null) invalid.add(l.key);
      return { kind: l.kind, nature: l.nature, quantity: quantity ?? "0", unitCostMinor: cost ?? 0n };
    });
    const mp = parsePercentInput(margin, { exclusiveMax: true });
    const tp = parsePercentInput(taxRate);
    const discount = parseQuoteDiscount(discountType, discountValue, minorUnit);
    if (mp === null) invalid.add("margin");
    if (tp === null) invalid.add("taxRate");
    if (discount === null) invalid.add("discount");
    if (invalid.size) return { breakdown: null, invalid };
    try {
      return {
        breakdown: computeQuote({ currency: quote.currency, lines: parsed, marginPercent: mp!, taxRatePercent: tp!, discount: discount! }),
        invalid,
      };
    } catch (err) {
      if (err instanceof QuoteDiscountTooLargeError) invalid.add("discountTooLarge");
      return { breakdown: null, invalid };
    }
  }, [lines, margin, taxRate, discountType, discountValue, minorUnit, quote.currency]);

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
              {clients ? (
                <SelectField
                  name="clientContactId"
                  label={m.quotes.fields.clientContact}
                  hint={m.quotes.fields.clientContactHint}
                  defaultValue={quote.clientContactId}
                  error={state.fieldErrors?.clientContactId}
                  options={[{ value: "", label: m.quotes.fields.noClientContact }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                  onChange={(event) => {
                    // Preenche os dados do cliente a partir do cadastro (continuam editáveis no orçamento).
                    const client = clients.find((c) => c.id === event.currentTarget.value);
                    const form = event.currentTarget.form;
                    if (!client || !form) return;
                    const set = (name: string, value: string) => {
                      const el = form.elements.namedItem(name);
                      if (el instanceof HTMLInputElement) el.value = value;
                    };
                    set("clientName", client.name);
                    set("clientEmail", client.email);
                    set("clientTaxId", client.taxId);
                    set("clientAddress", client.address);
                  }}
                />
              ) : (
                <input type="hidden" name="clientContactId" value={quote.clientContactId} />
              )}
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
              <div className="hidden gap-2 text-xs text-subtle md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_72px_64px_104px_104px_36px]">
                <span>{m.quotes.line.kind}</span>
                <span>{m.quotes.line.nature}</span>
                <span>{m.quotes.line.quantity}</span>
                <span>{m.quotes.line.unit}</span>
                <span>{m.quotes.line.unitCost}</span>
                <span className="text-right">{m.quotes.line.total}</span>
                <span />
              </div>
              <ul className="flex flex-col gap-3">
                {lines.map((l, i) => {
                  const bad = preview.invalid.has(l.key);
                  const total = b?.lineTotals[i];
                  return (
                    <li
                      key={l.key}
                      className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_72px_64px_104px_104px_36px] md:items-center md:rounded-none md:border-x-0 md:border-b-0 md:px-0 md:pb-0 md:first:border-t-0 md:first:pt-0 animate-[rise-in_200ms_ease-out]"
                    >
                      <input aria-label={m.quotes.line.description} value={l.description} maxLength={300} onChange={(e) => update(l.key, { description: e.target.value })} className={cx(cellInput, "col-span-2 md:col-span-7")} />
                      <select
                        aria-label={m.quotes.line.kind}
                        value={l.kind}
                        onChange={(e) => {
                          const kind = e.target.value as QuoteItemKind;
                          // A natureza acompanha o tipo enquanto o utilizador não a escolher à mão.
                          update(l.key, l.nature === defaultNature(l.kind) ? { kind, nature: defaultNature(kind) } : { kind });
                        }}
                        className={cellInput}
                      >
                        {QUOTE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>{m.quotes.line.kinds[k]}</option>
                        ))}
                      </select>
                      <select aria-label={m.quotes.line.nature} value={l.nature} onChange={(e) => update(l.key, { nature: e.target.value as QuoteItemNature })} className={cellInput}>
                        {QUOTE_ITEM_NATURES.map((n) => (
                          <option key={n} value={n}>{m.quotes.line.natures[n]}</option>
                        ))}
                      </select>
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
                      onClick={() => setLines((ls) => [...ls, { key: newKey(), kind: k, nature: defaultNature(k), description: m.quotes.line.kinds[k], quantity: "1", unit: k === "labor" ? "h" : k === "travel" ? "km" : "un", unitCost: "" }])}
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
              <div className="grid grid-cols-[1fr_120px] items-end gap-3 border-t border-line pt-4">
                <SelectField
                  name="discountType"
                  label={m.quotes.fields.discountType}
                  value={discountType}
                  onChange={(e) => setDiscountType(e.currentTarget.value as EditorQuote["discountType"])}
                  options={QUOTE_DISCOUNT_TYPES.map((t) => ({ value: t, label: m.quotes.fields.discountTypes[t] }))}
                />
                <Field
                  name="discountValue"
                  label={m.quotes.fields.discountValue}
                  placeholder={discountType === "percent" ? "%" : quote.currency}
                  inputMode="decimal"
                  value={discountType === "none" ? "" : discountValue}
                  disabled={discountType === "none"}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  error={state.fieldErrors?.discountValue ?? (preview.invalid.has("discountTooLarge") ? m.errors.discount_too_large : undefined)}
                  className="tabular"
                />
              </div>
              <p className="text-xs text-subtle">{m.quotes.fields.discountHint}</p>
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
                  {b.subtotalByNature.product.amountMinor > 0n && b.subtotalByNature.service.amountMinor > 0n ? (
                    <p className="text-xs text-subtle">
                      {m.quotes.summary.products} {fmt(b.subtotalByNature.product.amountMinor)} · {m.quotes.summary.services}{" "}
                      {fmt(b.subtotalByNature.service.amountMinor)}
                    </p>
                  ) : null}
                  {b.discount.amountMinor > 0n ? (
                    <>
                      <Row label={m.quotes.summary.subtotal} value={fmt(b.subtotal.amountMinor)} />
                      <Row label={m.quotes.summary.discount} value={`− ${fmt(b.discount.amountMinor)}`} />
                    </>
                  ) : null}
                  <Row label={m.quotes.summary.price} value={fmt(b.priceBeforeTax.amountMinor)} />
                  <Row label={m.quotes.summary.tax} value={fmt(b.tax.amountMinor)} />
                  <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                    <dt className="font-medium">{m.quotes.summary.total}</dt>
                    <dd className="tabular text-2xl font-bold text-brand">{fmt(b.total.amountMinor)}</dd>
                  </div>
                  {b.belowCost ? (
                    <p role="status" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                      {m.quotes.summary.belowCost}
                    </p>
                  ) : null}
                </dl>
              ) : (
                <p className="border-t border-line pt-4 text-sm text-danger">{m.quotes.summary.invalid}</p>
              )}
              {readOnly ? null : (
                <SubmitButton pendingLabel={m.common.saving} className="w-full max-xl:hidden">
                  {m.quotes.save}
                </SubmitButton>
              )}
            </section>
          </aside>
          {/* Telemóvel e ecrãs médios: total e "Guardar" sempre à mão, por cima da barra inferior. */}
          {readOnly ? null : (
            <div className="glass fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 lg:bottom-6 lg:left-[300px] lg:right-8 xl:hidden">
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-subtle">{m.quotes.summary.total}</span>
                <span className="tabular truncate text-lg font-bold text-brand">{b ? fmt(b.total.amountMinor) : "—"}</span>
              </span>
              <SubmitButton pendingLabel={m.common.saving} className="h-11 shrink-0 px-5">
                {m.quotes.save}
              </SubmitButton>
            </div>
          )}
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
