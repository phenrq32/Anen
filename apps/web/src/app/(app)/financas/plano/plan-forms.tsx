"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import { deleteFixedExpenseAction, saveFixedExpenseAction, savePlanAction } from "./actions";

export function PlanForm({
  m,
  month,
  currency,
  salary,
  reserve,
}: {
  m: Messages;
  month: string;
  currency: string;
  salary: string;
  reserve: string;
}) {
  const t = m.finance.plan;
  return (
    <ActionForm action={savePlanAction}>
      {(state) => (
        <>
          <input type="hidden" name="month" value={month} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="salary"
              label={`${t.salary} (${currency})`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              defaultValue={salary}
              hint={t.salaryHint}
              required
              error={state.fieldErrors?.salary}
              className="tabular text-lg"
            />
            <Field
              name="reserve"
              label={`${t.reserve} (${currency})`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              defaultValue={reserve}
              hint={t.reserveHint}
              error={state.fieldErrors?.reserve}
              className="tabular"
            />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.savePlan}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function AddFixedExpenseForm({ m, categories }: { m: Messages; categories: { id: string; label: string }[] }) {
  const t = m.finance.plan;
  return (
    <ActionForm action={saveFixedExpenseAction}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-[1fr_160px_200px_auto] sm:items-end">
          <Field name="name" label={t.fixedName} required maxLength={80} error={state.fieldErrors?.name} />
          <Field name="amount" label={t.fixedAmount} inputMode="decimal" autoComplete="off" placeholder="0,00" required error={state.fieldErrors?.amount} className="tabular" />
          <SelectField
            name="categoryId"
            label={m.finance.tx.category}
            optionalLabel={m.common.optional}
            defaultValue=""
            options={[{ value: "", label: m.finance.tx.noCategory }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
            error={state.fieldErrors?.categoryId}
          />
          <SubmitButton pendingLabel={m.common.saving}>{t.addFixed}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

/** Linha de despesa fixa com o valor editável no próprio lugar. */
export function FixedExpenseRow({ m, id, name, amount, categoryLabel }: { m: Messages; id: string; name: string; amount: string; categoryLabel: string | null }) {
  const t = m.finance.plan;
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 sm:pt-2.5">
        <p className="truncate text-sm font-medium">{name}</p>
        {categoryLabel ? <p className="truncate text-xs text-subtle">{categoryLabel}</p> : null}
      </div>
      <ActionForm action={saveFixedExpenseAction} className="!flex-row !gap-2">
        {(state) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="name" value={name} />
            <label htmlFor={`fx-${id}`} className="sr-only">{`${t.fixedAmount}: ${name}`}</label>
            <input
              id={`fx-${id}`}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={amount}
              aria-invalid={state.fieldErrors?.amount ? true : undefined}
              className="tabular h-10 w-32 rounded-md border border-line bg-ink px-3 text-right text-sm text-paper focus:border-brand focus:outline-none aria-[invalid=true]:border-danger"
            />
            <SubmitButton variant="secondary" pendingLabel={m.common.saving} className="h-10 px-3">
              {t.updateAmount}
            </SubmitButton>
          </>
        )}
      </ActionForm>
      <InlineAction action={deleteFixedExpenseAction} fields={{ id }} label={t.remove} pendingLabel={m.common.saving} confirmMessage={t.removeConfirm} />
    </li>
  );
}
