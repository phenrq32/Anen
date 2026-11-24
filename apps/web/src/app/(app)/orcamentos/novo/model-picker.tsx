"use client";

import { useState } from "react";
import { computeQuote, quoteLinesFromServiceModel, SERVICE_MODEL_MARGIN_PERCENT } from "@anen/financial-engine";
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
 * Escolher um serviço com preço e a quantidade. A pré-visualização usa o motor (computeQuote, margem 0 %);
 * o servidor volta a calcular ao criar o orçamento.
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
  const [selected, setSelected] = useState(models[0]?.key ?? "");
  const [quantity, setQuantity] = useState("1");
  const [addTax, setAddTax] = useState(false);
  const money = (v: bigint) => formatMoney(v, currency, minorUnit, locale);
  const model = models.find((x) => x.key === selected);
  const qty = parseQuantityInput(quantity);
  const preview =
    model && qty !== null && Number(qty) > 0
      ? computeQuote({
          currency,
          lines: quoteLinesFromServiceModel(
            { unit: model.unit, composition: model.composition.map((c) => ({ line: c.line, kind: c.kind, amountMinor: BigInt(c.amountMinor) })) },
            qty,
          ).map((l) => ({ kind: l.kind, nature: l.nature, quantity: l.quantity, unitCostMinor: l.unitCostMinor })),
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
            <legend className="mb-2 text-sm font-medium">{t.choose}</legend>
            <ul className="flex flex-col gap-2">
              {models.map((x) => (
                <li key={x.key}>
                  <label
                    className={cx(
                      "flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 transition-colors",
                      selected === x.key ? "border-brand/60 bg-brand/5" : "border-line hover:border-graphite-soft",
                    )}
                  >
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <input type="radio" name="service" value={x.key} checked={selected === x.key} onChange={() => setSelected(x.key)} className="accent-[#FF851B]" />
                        {x.name}
                      </span>
                      <span className="tabular text-sm font-semibold">{format(t.recommended, { price: money(BigInt(x.recommendedMinor)), unit: x.unit })}</span>
                    </span>
                    <span className="tabular text-xs text-subtle">
                      {format(t.range, { min: money(BigInt(x.rangeMinMinor)), max: money(BigInt(x.rangeMaxMinor)) })}
                    </span>
                    {x.materials ? <span className="text-xs text-muted">{format(t.materials, { materials: x.materials })}</span> : null}
                    {x.note ? <span className="text-xs text-subtle">{x.note}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="quantity"
              label={format(t.quantity, { unit: model?.unit ?? "" })}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              error={state.fieldErrors?.quantity}
              className="tabular"
            />
            {suggestedTax ? (
              <label className="flex items-center gap-2 self-end pb-3 text-sm">
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
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.create}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
