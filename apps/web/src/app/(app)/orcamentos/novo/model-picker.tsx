"use client";

import { useState } from "react";
import { computeQuote, quoteLinesFromServiceModels, SERVICE_MODEL_MARGIN_PERCENT, SERVICE_MODEL_MAX_SELECTION } from "@anen/financial-engine";
import { format, formatMoney, type Messages } from "@anen/i18n";
import type { Locale, QuoteItemKind } from "@anen/types";
import { parseQuantityInput } from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, cx } from "@/components/ui";
import { createQuoteFromModelAction } from "../actions";

export interface PickerModel {
  key: string;
  name: string;
  unit: string;
  recommendedMinor: string;
  rangeMinMinor: string;
  rangeMaxMinor: string;
  materials: string | null;
  note: string | null;
  composition: { line: string; kind: QuoteItemKind; amountMinor: string }[];
}

/**
 * Escolher um ou mais serviços com preço, cada um com a sua quantidade. A pré-visualização usa o motor
 * (computeQuote, margem 0 %); o servidor volta a calcular ao criar o orçamento.
 */
export function ModelPicker({
  m,
  locale,
  setId,
  currency,
  minorUnit,
  suggestedTax,
  models,
}: {
  m: Messages;
  locale: Locale;
  setId: string;
  currency: string;
  minorUnit: number;
  suggestedTax: { percent: string; label: string } | null;
  models: PickerModel[];
}) {
  const t = m.quotes.models;
  /** Serviços escolhidos, pela ordem em que foram escolhidos, com a quantidade de cada um. */
  const [selected, setSelected] = useState<{ key: string; quantity: string }[]>([]);
  const [addTax, setAddTax] = useState(false);
  const money = (v: bigint) => formatMoney(v, currency, minorUnit, locale);
  const byKey = new Map(models.map((x) => [x.key, x]));

  const toggle = (key: string, on: boolean) =>
    setSelected((cur) => (on ? (cur.some((s) => s.key === key) || cur.length >= SERVICE_MODEL_MAX_SELECTION ? cur : [...cur, { key, quantity: "1" }]) : cur.filter((s) => s.key !== key)));
  const setQuantity = (key: string, quantity: string) => setSelected((cur) => cur.map((s) => (s.key === key ? { ...s, quantity } : s)));

  const items = selected.flatMap((s) => {
    const model = byKey.get(s.key);
    const qty = parseQuantityInput(s.quantity);
    if (!model || qty === null || Number(qty) <= 0) return [];
    return [{ name: model.name, unit: model.unit, quantity: qty, composition: model.composition.map((c) => ({ line: c.line, kind: c.kind, amountMinor: BigInt(c.amountMinor) })) }];
  });
  const preview =
    items.length > 0 && items.length === selected.length
      ? computeQuote({
          currency,
          lines: quoteLinesFromServiceModels(items).map((l) => ({ kind: l.kind, nature: l.nature, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
          marginPercent: SERVICE_MODEL_MARGIN_PERCENT,
          taxRatePercent: addTax && suggestedTax ? suggestedTax.percent : "0",
        })
      : null;

  return (
    <ActionForm action={createQuoteFromModelAction}>
      {(state) => (
        <>
          <input type="hidden" name="set" value={setId} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t.choose}</legend>
            <p className="mb-2 text-xs text-subtle">{t.chooseHint}</p>
            <ul className="flex flex-col gap-2">
              {models.map((x) => {
                const pick = selected.find((s) => s.key === x.key);
                return (
                  <li key={x.key} aria-label={x.name}>
                    <div
                      className={cx(
                        "flex flex-col gap-1 rounded-xl border px-4 py-3 transition-colors",
                        pick ? "border-brand/60 bg-brand/5" : "border-line hover:border-graphite-soft",
                      )}
                    >
                      <label className="flex cursor-pointer flex-wrap items-start justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium">
                          <input
                            type="checkbox"
                            name="service"
                            value={x.key}
                            checked={Boolean(pick)}
                            onChange={(e) => toggle(x.key, e.target.checked)}
                            className="size-4 accent-[#FF851B]"
                          />
                          {x.name}
                        </span>
                        <span className="tabular text-sm font-semibold">{format(t.recommended, { price: money(BigInt(x.recommendedMinor)), unit: x.unit })}</span>
                      </label>
                      <span className="tabular text-xs text-subtle">
                        {format(t.range, { min: money(BigInt(x.rangeMinMinor)), max: money(BigInt(x.rangeMaxMinor)) })}
                      </span>
                      {x.materials ? <span className="text-xs text-muted">{format(t.materials, { materials: x.materials })}</span> : null}
                      {x.note ? <span className="text-xs text-subtle">{x.note}</span> : null}
                      {pick ? (
                        <div className="mt-2 max-w-xs">
                          <Field
                            name={`quantity_${x.key}`}
                            label={format(t.quantity, { unit: x.unit })}
                            inputMode="decimal"
                            value={pick.quantity}
                            onChange={(e) => setQuantity(x.key, e.target.value)}
                            required
                            error={state.fieldErrors?.[`quantity_${x.key}`]}
                            className="tabular"
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-sm text-muted" aria-live="polite">
              {format(t.selected, { count: selected.length })}
            </span>
            {suggestedTax ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="addTax" value="1" checked={addTax} onChange={(e) => setAddTax(e.target.checked)} className="size-4 accent-[#FF851B]" />
                {format(t.addTax, { label: suggestedTax.label })}
              </label>
            ) : null}
          </div>
          {preview ? (
            <p className="tabular text-lg font-semibold" aria-live="polite">
              {format(t.totalPreview, { total: money(preview.total.amountMinor) })}
            </p>
          ) : null}
          <p className="text-xs text-subtle">{t.marginNote}</p>
          <SubmitButton pendingLabel={m.common.saving} className="self-start" disabled={selected.length === 0}>
            {t.create}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
