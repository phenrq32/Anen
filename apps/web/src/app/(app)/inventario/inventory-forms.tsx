"use client";

import { useEffect, useRef, useState } from "react";
import type { Messages } from "@anen/i18n";
import type { StockItem, StockMovementKind } from "@anen/types";
import { STOCK_MOVEMENT_KINDS } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import type { FormState } from "@/lib/form";
import {
  createReorderDraftsAction,
  deleteStockItemAction,
  recordStockMovementAction,
  saveStockItemAction,
  toggleArchiveStockItemAction,
} from "./actions";

function ResetOnSuccess({ state }: { state: FormState }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.closest("form")?.reset();
  }, [state]);
  return <span ref={ref} hidden />;
}

/** "12.500" → "12,5" (para preencher campos de quantidade). */
function quantityInput(v: string | number | null): string {
  if (v === null) return "";
  return Number(v).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
}

export interface SupplierOption {
  id: string;
  name: string;
}

export function StockItemForm({
  m,
  initial,
  suppliers,
  currencies,
  defaultCurrency,
}: {
  m: Messages;
  initial?: StockItem;
  suppliers: SupplierOption[];
  currencies: string[];
  defaultCurrency: string;
}) {
  const t = m.inventory.fields;
  return (
    <ActionForm action={saveStockItemAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field name="name" label={t.name} required maxLength={160} defaultValue={initial?.name} error={state.fieldErrors?.name} />
            <Field name="sku" label={t.sku} optionalLabel={m.common.optional} maxLength={60} defaultValue={initial?.sku ?? ""} error={state.fieldErrors?.sku} />
          </div>
          {initial ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="unit" label={t.unit} hint={t.unitHint} required maxLength={20} error={state.fieldErrors?.unit} />
              <SelectField
                name="currencyCode"
                label={t.currency}
                defaultValue={defaultCurrency}
                options={currencies.map((c) => ({ value: c, label: c }))}
                error={state.fieldErrors?.currencyCode}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="minQuantity"
              label={t.minQuantity}
              hint={t.minHint}
              inputMode="decimal"
              maxLength={20}
              defaultValue={initial ? quantityInput(initial.min_quantity) : ""}
              error={state.fieldErrors?.minQuantity}
            />
            <Field
              name="targetQuantity"
              label={t.targetQuantity}
              hint={t.targetHint}
              optionalLabel={m.common.optional}
              inputMode="decimal"
              maxLength={20}
              defaultValue={initial ? quantityInput(initial.target_quantity) : ""}
              error={state.fieldErrors?.targetQuantity}
            />
          </div>
          <SelectField
            name="preferredSupplierId"
            label={t.preferredSupplier}
            optionalLabel={m.common.optional}
            defaultValue={initial?.preferred_supplier_id ?? ""}
            options={[{ value: "", label: t.noSupplier }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
            error={state.fieldErrors?.preferredSupplierId}
          />
          <Field name="notes" label={t.notes} optionalLabel={m.common.optional} maxLength={1000} defaultValue={initial?.notes ?? ""} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {initial ? m.common.save : m.inventory.create}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

/** Lote com quantidade, para escolher de onde sai uma saída ou perda. */
export interface LotChoice {
  id: string;
  label: string;
}

export function StockMovementForm({
  m,
  itemId,
  unit,
  today,
  lots = [],
}: {
  m: Messages;
  itemId: string;
  unit: string;
  today: string;
  lots?: LotChoice[];
}) {
  const t = m.inventory.movement;
  const [kind, setKind] = useState<StockMovementKind>("in");
  return (
    <ActionForm action={recordStockMovementAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <ResetOnSuccess state={state} />
          <input type="hidden" name="itemId" value={itemId} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              name="kind"
              label={t.kind}
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value as StockMovementKind)}
              options={STOCK_MOVEMENT_KINDS.map((k) => ({ value: k, label: t.kinds[k] }))}
              error={state.fieldErrors?.kind}
            />
            <Field
              name="quantity"
              label={`${t.quantity} (${unit})`}
              hint={kind === "count" ? t.quantityHint : undefined}
              inputMode="decimal"
              required
              maxLength={20}
              error={state.fieldErrors?.quantity}
            />
            <Field name="occurredOn" type="date" label={t.date} defaultValue={today} required error={state.fieldErrors?.occurredOn} />
          </div>
          {kind === "in" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="unitCost" label={`${t.unitCost} / ${unit}`} hint={t.unitCostHint} inputMode="decimal" required maxLength={32} error={state.fieldErrors?.unitCost} />
              <Field name="lotCode" label={t.lotCode} optionalLabel={m.common.optional} hint={t.lotCodeHint} maxLength={60} error={state.fieldErrors?.lotCode} />
              <Field name="expiresOn" type="date" label={t.expiresOn} optionalLabel={m.common.optional} hint={t.expiresHint} error={state.fieldErrors?.expiresOn} />
            </div>
          ) : null}
          {(kind === "out" || kind === "loss") && lots.length > 1 ? (
            <SelectField
              name="lotId"
              label={t.lot}
              defaultValue=""
              options={[{ value: "", label: t.lotAuto }, ...lots.map((l) => ({ value: l.id, label: l.label }))]}
              error={state.fieldErrors?.lotId}
            />
          ) : null}
          <Field name="notes" label={t.notes} optionalLabel={m.common.optional} maxLength={500} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.submit}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveStockItemButton({ m, id, archived }: { m: Messages; id: string; archived: boolean }) {
  return (
    <InlineAction
      action={toggleArchiveStockItemAction}
      fields={{ id, archive: archived ? "0" : "1" }}
      label={archived ? m.inventory.unarchive : m.inventory.archive}
      pendingLabel={m.common.saving}
      variant="secondary"
    />
  );
}

export function DeleteStockItemButton({ m, id }: { m: Messages; id: string }) {
  return (
    <InlineAction
      action={deleteStockItemAction}
      fields={{ id }}
      label={m.inventory.delete}
      pendingLabel={m.common.saving}
      confirmMessage={m.inventory.confirmDelete}
      variant="danger"
    />
  );
}

export function ReorderButton({ m }: { m: Messages }) {
  return (
    <ActionForm action={createReorderDraftsAction}>
      {() => (
        <SubmitButton pendingLabel={m.common.saving} className="self-start">
          {m.inventory.reorder.create}
        </SubmitButton>
      )}
    </ActionForm>
  );
}
