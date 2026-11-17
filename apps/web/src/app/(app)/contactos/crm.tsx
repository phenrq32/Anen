"use client";

import { useEffect, useRef } from "react";
import type { Messages } from "@anen/i18n";
import { CONTACT_NOTE_KINDS } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import type { FormState } from "@/lib/form";
import {
  deleteContactNoteAction,
  deleteSupplierPriceAction,
  saveContactNoteAction,
  saveSupplierPriceAction,
} from "./actions";

/** Limpa o formulário depois de cada registo com sucesso (cada envio devolve um estado novo). */
function ResetOnSuccess({ state }: { state: FormState }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (state.status === "success") ref.current?.closest("form")?.reset();
  }, [state]);
  return <span ref={ref} hidden />;
}

export function ContactNoteForm({ m, contactId, today }: { m: Messages; contactId: string; today: string }) {
  const t = m.business.contacts;
  return (
    <ActionForm action={saveContactNoteAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <ResetOnSuccess state={state} />
          <input type="hidden" name="contactId" value={contactId} />
          <div className="grid gap-4 sm:grid-cols-[180px_180px]">
            <SelectField
              name="kind"
              label={t.noteKind}
              defaultValue="note"
              options={CONTACT_NOTE_KINDS.map((k) => ({ value: k, label: t.noteKinds[k] }))}
              error={state.fieldErrors?.kind}
            />
            <Field name="notedOn" type="date" label={t.notedOn} defaultValue={today} required error={state.fieldErrors?.notedOn} />
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t.noteBody}</span>
            <textarea
              name="body"
              required
              maxLength={4000}
              rows={3}
              aria-invalid={Boolean(state.fieldErrors?.body)}
              className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-paper focus:border-brand focus:outline-none"
            />
            {state.fieldErrors?.body ? <span role="alert" className="text-[13px] text-danger">{state.fieldErrors.body}</span> : null}
          </label>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.addNote}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function DeleteNoteButton({ m, id }: { m: Messages; id: string }) {
  const t = m.business.contacts;
  return (
    <InlineAction
      action={deleteContactNoteAction}
      fields={{ id }}
      label={t.deleteNote}
      pendingLabel={m.common.saving}
      confirmMessage={t.confirmDeleteNote}
    />
  );
}

export interface ExpenseOption {
  id: string;
  label: string;
  currency: string;
}

export function SupplierPriceForm({
  m,
  contactId,
  today,
  currencies,
  defaultCurrency,
  expenses,
}: {
  m: Messages;
  contactId: string;
  today: string;
  currencies: string[];
  defaultCurrency: string;
  expenses: ExpenseOption[];
}) {
  const t = m.business.contacts;
  return (
    <ActionForm action={saveSupplierPriceAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <ResetOnSuccess state={state} />
          <input type="hidden" name="contactId" value={contactId} />
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field name="itemName" label={t.item} required maxLength={160} error={state.fieldErrors?.itemName} />
            <Field name="unit" label={t.unit} optionalLabel={m.common.optional} maxLength={20} error={state.fieldErrors?.unit} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="unitPrice" label={t.unitPrice} inputMode="decimal" required maxLength={32} error={state.fieldErrors?.unitPrice} />
            <SelectField
              name="currencyCode"
              label={t.currency}
              defaultValue={defaultCurrency}
              options={currencies.map((c) => ({ value: c, label: c }))}
              error={state.fieldErrors?.currencyCode}
            />
            <Field name="observedOn" type="date" label={t.observedOn} defaultValue={today} required error={state.fieldErrors?.observedOn} />
          </div>
          {expenses.length > 0 ? (
            <SelectField
              name="transactionId"
              label={t.linkedExpense}
              optionalLabel={m.common.optional}
              defaultValue=""
              options={[{ value: "", label: t.noLinkedExpense }, ...expenses.map((e) => ({ value: e.id, label: e.label }))]}
              error={state.fieldErrors?.transactionId}
            />
          ) : null}
          <Field name="notes" label={t.priceNotes} optionalLabel={m.common.optional} maxLength={500} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.addPrice}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function DeletePriceButton({ m, id }: { m: Messages; id: string }) {
  const t = m.business.contacts;
  return (
    <InlineAction
      action={deleteSupplierPriceAction}
      fields={{ id }}
      label={t.deletePrice}
      pendingLabel={m.common.saving}
      confirmMessage={t.confirmDeletePrice}
    />
  );
}
