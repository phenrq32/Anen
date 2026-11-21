"use client";

import { useEffect, useRef, useState } from "react";
import type { Messages } from "@anen/i18n";
import type { PurchaseOrder } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import type { FormState } from "@/lib/form";
import {
  addPurchaseLineAction,
  createPurchaseOrderAction,
  deletePurchaseOrderAction,
  receivePurchaseOrderAction,
  removePurchaseLineAction,
  savePurchaseOrderAction,
  setPurchaseStatusAction,
} from "./actions";

function ResetOnSuccess({ state, onReset }: { state: FormState; onReset?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      ref.current?.closest("form")?.reset();
      onReset?.();
    }
  }, [state, onReset]);
  return <span ref={ref} hidden />;
}

export interface Option {
  id: string;
  name: string;
}

export function NewPurchaseOrderForm({
  m,
  suppliers,
  currencies,
  defaultCurrency,
}: {
  m: Messages;
  suppliers: Option[];
  currencies: string[];
  defaultCurrency: string;
}) {
  const t = m.purchases.fields;
  return (
    <ActionForm action={createPurchaseOrderAction}>
      {(state) => (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <SelectField
            name="supplierId"
            label={t.supplier}
            className="sm:min-w-64"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            error={state.fieldErrors?.supplierId}
          />
          <SelectField
            name="currencyCode"
            label={t.currency}
            defaultValue={defaultCurrency}
            options={currencies.map((c) => ({ value: c, label: c }))}
            error={state.fieldErrors?.currencyCode}
          />
          <SubmitButton pendingLabel={m.common.saving}>{m.purchases.create}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function PurchaseOrderDetailsForm({
  m,
  order,
  suppliers,
  projects,
  currencies,
  hasLines,
}: {
  m: Messages;
  order: PurchaseOrder;
  suppliers: Option[];
  projects: (Option & { currency: string })[];
  currencies: string[];
  hasLines: boolean;
}) {
  const t = m.purchases.fields;
  return (
    <ActionForm action={savePurchaseOrderAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="id" value={order.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="supplierId"
              label={t.supplier}
              defaultValue={order.supplier_id ?? ""}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              error={state.fieldErrors?.supplierId}
            />
            {hasLines ? (
              <input type="hidden" name="currencyCode" value={order.currency_code} />
            ) : (
              <SelectField
                name="currencyCode"
                label={t.currency}
                defaultValue={order.currency_code}
                options={currencies.map((c) => ({ value: c, label: c }))}
                error={state.fieldErrors?.currencyCode}
              />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              name="projectId"
              label={t.project}
              optionalLabel={m.common.optional}
              defaultValue={order.project_id ?? ""}
              options={[
                { value: "", label: t.noProject },
                ...projects.filter((p) => p.currency === order.currency_code).map((p) => ({ value: p.id, label: p.name })),
              ]}
              error={state.fieldErrors?.projectId}
            />
            <Field name="orderedOn" type="date" label={t.orderedOn} optionalLabel={m.common.optional} defaultValue={order.ordered_on ?? ""} error={state.fieldErrors?.orderedOn} />
            <Field name="expectedOn" type="date" label={t.expectedOn} optionalLabel={m.common.optional} defaultValue={order.expected_on ?? ""} error={state.fieldErrors?.expectedOn} />
          </div>
          <Field name="notes" label={t.notes} optionalLabel={m.common.optional} maxLength={2000} defaultValue={order.notes ?? ""} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} variant="secondary" className="self-start">
            {m.common.save}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export interface StockOption extends Option {
  unit: string;
}

export function AddPurchaseLineForm({ m, orderId, stockItems }: { m: Messages; orderId: string; stockItems: StockOption[] }) {
  const t = m.purchases.lines;
  const [stockItemId, setStockItemId] = useState("");
  const selected = stockItems.find((s) => s.id === stockItemId);
  return (
    <ActionForm action={addPurchaseLineAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <ResetOnSuccess state={state} onReset={() => setStockItemId("")} />
          <input type="hidden" name="orderId" value={orderId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="stockItemId"
              label={t.stockItem}
              value={stockItemId}
              onChange={(e) => setStockItemId(e.currentTarget.value)}
              options={[{ value: "", label: t.noStockItem }, ...stockItems.map((s) => ({ value: s.id, label: `${s.name} (${s.unit})` }))]}
              error={state.fieldErrors?.stockItemId}
            />
            <Field
              name="description"
              label={t.description}
              hint={selected ? t.descriptionHint : undefined}
              required={!selected}
              optionalLabel={selected ? m.common.optional : undefined}
              maxLength={160}
              error={state.fieldErrors?.description}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="quantity" label={t.quantity} inputMode="decimal" required maxLength={20} error={state.fieldErrors?.quantity} />
            {selected ? (
              <Field key={selected.id} name="unit" label={t.unit} hint={t.unitHint} value={selected.unit} readOnly />
            ) : (
              <Field name="unit" label={t.unit} optionalLabel={m.common.optional} maxLength={20} error={state.fieldErrors?.unit} />
            )}
            <Field name="unitPrice" label={t.unitPrice} inputMode="decimal" required maxLength={32} error={state.fieldErrors?.unitPrice} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} variant="secondary" className="self-start">
            {t.add}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function RemoveLineButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={removePurchaseLineAction} fields={{ id }} label={m.purchases.lines.remove} pendingLabel={m.common.saving} />;
}

export function StatusButton({
  m,
  id,
  status,
  label,
  confirmMessage,
  variant = "secondary",
}: {
  m: Messages;
  id: string;
  status: "ordered" | "draft" | "cancelled";
  label: string;
  confirmMessage?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <InlineAction
      action={setPurchaseStatusAction}
      fields={{ id, status }}
      label={label}
      pendingLabel={m.common.saving}
      confirmMessage={confirmMessage}
      variant={variant}
    />
  );
}

export function DeleteOrderButton({ m, id }: { m: Messages; id: string }) {
  return (
    <InlineAction
      action={deletePurchaseOrderAction}
      fields={{ id }}
      label={m.purchases.actions.delete}
      pendingLabel={m.common.saving}
      confirmMessage={m.purchases.actions.confirmDelete}
      variant="danger"
    />
  );
}

export function ReceiveForm({
  m,
  orderId,
  today,
  accounts,
  financeNote,
}: {
  m: Messages;
  orderId: string;
  today: string;
  accounts: Option[];
  /** Quando não se pode criar a despesa, o motivo (sem permissão ou sem contas na moeda). */
  financeNote: string | null;
}) {
  const t = m.purchases.receive;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  return (
    <ActionForm action={receivePurchaseOrderAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="orderId" value={orderId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="receivedOn" type="date" label={t.date} defaultValue={today} required error={state.fieldErrors?.receivedOn} />
            {financeNote ? (
              <p className="self-end text-sm text-muted">{financeNote}</p>
            ) : (
              <SelectField
                name="accountId"
                label={t.account}
                value={accountId}
                onChange={(e) => setAccountId(e.currentTarget.value)}
                options={[...accounts.map((a) => ({ value: a.id, label: a.name })), { value: "", label: t.noAccount }]}
                error={state.fieldErrors?.accountId}
              />
            )}
          </div>
          {!financeNote && accountId ? (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="paid" value="1" defaultChecked className="mt-0.5 size-4 accent-[#FF851B]" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{t.paid}</span>
                <span className="text-subtle">{t.paidHint}</span>
              </span>
            </label>
          ) : null}
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.submit}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
