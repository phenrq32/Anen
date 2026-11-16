"use client";

import { useState } from "react";
import type { Messages } from "@anen/i18n";
import type { TransactionKind } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField, cx } from "@/components/ui";
import {
  archiveCategoryAction,
  deleteBudgetAction,
  deleteGoalAction,
  deleteRecurringAction,
  deleteTransactionAction,
  saveAccountAction,
  saveBudgetAction,
  saveCategoryAction,
  saveGoalAction,
  saveRecurringAction,
  saveTransactionAction,
  toggleArchiveAccountAction,
  toggleRecurringAction,
} from "./actions";

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
}
export interface CategoryOption {
  id: string;
  label: string;
  kind: TransactionKind;
}

export function KindToggle({
  m,
  value,
  onChange,
  name = "kind",
}: {
  m: Messages;
  value: TransactionKind;
  onChange: (kind: TransactionKind) => void;
  name?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{m.finance.tx.kind}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-ink p-1">
        {(["expense", "income"] as const).map((k) => (
          <label
            key={k}
            className={cx(
              "flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md text-sm transition-colors",
              value === k ? "bg-graphite font-medium text-paper" : "text-muted hover:text-paper",
            )}
          >
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="sr-only" />
            <span className={cx("size-2 rounded-full", k === "income" ? "bg-chart-income" : "bg-chart-expense")} aria-hidden />
            {k === "income" ? m.finance.tx.income : m.finance.tx.expense}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface TransactionInitial {
  id: string;
  kind: TransactionKind;
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string | null;
  description: string;
  counterparty: string | null;
  notes: string | null;
}

export function TransactionFields({
  m,
  accounts,
  categories,
  defaults,
  initial,
  errors,
  compact = false,
}: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaults: { date: string; accountId?: string };
  initial?: TransactionInitial;
  errors?: Record<string, string> | undefined;
  compact?: boolean;
}) {
  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? "expense");
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults.accountId ?? accounts[0]?.id ?? "");
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "";
  const filtered = categories.filter((c) => c.kind === kind);
  return (
    <>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <KindToggle m={m} value={kind} onChange={setKind} />
      <div className={cx("grid gap-4", compact ? "grid-cols-2" : "sm:grid-cols-3")}>
        <Field
          name="amount"
          label={`${m.finance.tx.amount}${currency ? ` (${currency})` : ""}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          defaultValue={initial?.amount}
          required
          error={errors?.amount}
          className="tabular text-lg"
        />
        <Field name="occurredOn" type="date" label={m.finance.tx.date} defaultValue={initial?.occurredOn ?? defaults.date} required error={errors?.occurredOn} />
        <SelectField
          name="accountId"
          label={m.finance.tx.account}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
          error={errors?.accountId}
          className={compact ? "col-span-2" : undefined}
        />
      </div>
      <Field name="description" label={m.finance.tx.description} defaultValue={initial?.description} required maxLength={200} error={errors?.description} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          key={kind}
          name="categoryId"
          label={m.finance.tx.category}
          defaultValue={initial?.kind === kind ? (initial.categoryId ?? "") : ""}
          options={[{ value: "", label: m.finance.tx.noCategory }, ...filtered.map((c) => ({ value: c.id, label: c.label }))]}
          error={errors?.categoryId}
        />
        <Field
          name="counterparty"
          label={m.finance.tx.counterparty}
          optionalLabel={m.common.optional}
          defaultValue={initial?.counterparty ?? ""}
          maxLength={120}
          error={errors?.counterparty}
        />
      </div>
      {compact ? null : (
        <Field name="notes" label={m.finance.tx.notes} optionalLabel={m.common.optional} defaultValue={initial?.notes ?? ""} maxLength={1000} error={errors?.notes} />
      )}
    </>
  );
}

export function TransactionForm(props: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaults: { date: string; accountId?: string };
  initial?: TransactionInitial;
}) {
  return (
    <ActionForm action={saveTransactionAction}>
      {(state) => (
        <>
          <TransactionFields {...props} errors={state.fieldErrors} />
          <SubmitButton pendingLabel={props.m.common.saving} className="self-start">
            {props.m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteTransactionButton({ m, id }: { m: Messages; id: string }) {
  return (
    <InlineAction
      action={deleteTransactionAction}
      fields={{ id }}
      label={m.finance.tx.delete}
      pendingLabel={m.common.saving}
      confirmMessage={m.finance.tx.deleteConfirm}
      variant="danger"
    />
  );
}

export function AccountForm({
  m,
  currencies,
  defaultCurrency,
  initial,
}: {
  m: Messages;
  currencies: { code: string; name: string }[];
  defaultCurrency: string;
  initial?: { id: string; name: string; kind: string; currency: string; opening: string; locked: boolean };
}) {
  return (
    <ActionForm action={saveAccountAction}>
      {(state) => (
        <>
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={m.finance.account.name} defaultValue={initial?.name} required maxLength={80} error={state.fieldErrors?.name} />
            <SelectField
              name="kind"
              label={m.finance.account.kind}
              defaultValue={initial?.kind ?? "checking"}
              options={(Object.keys(m.finance.account.kinds) as (keyof Messages["finance"]["account"]["kinds"])[]).map((k) => ({
                value: k,
                label: m.finance.account.kinds[k],
              }))}
            />
            {initial?.locked ? (
              <>
                <input type="hidden" name="currencyCode" value={initial.currency} />
                <Field name="currencyDisplay" label={m.finance.account.currency} value={initial.currency} readOnly disabled />
              </>
            ) : (
              <SelectField
                name="currencyCode"
                label={m.finance.account.currency}
                defaultValue={initial?.currency ?? defaultCurrency}
                options={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
                error={state.fieldErrors?.currencyCode}
              />
            )}
            <Field
              name="openingBalance"
              label={m.finance.account.opening}
              hint={m.finance.account.openingHint}
              inputMode="decimal"
              defaultValue={initial?.opening ?? "0"}
              error={state.fieldErrors?.openingBalance}
              className="tabular"
            />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ArchiveAccountButton({ m, id, archived }: { m: Messages; id: string; archived: boolean }) {
  return (
    <InlineAction
      action={toggleArchiveAccountAction}
      fields={{ id, archive: archived ? "0" : "1" }}
      label={archived ? m.finance.account.unarchive : m.finance.account.archive}
      pendingLabel={m.common.saving}
    />
  );
}

export function BudgetForm({
  m,
  categories,
  month,
  currencies,
  defaultCurrency,
}: {
  m: Messages;
  categories: CategoryOption[];
  month: string;
  currencies: string[];
  defaultCurrency: string;
}) {
  return (
    <ActionForm action={saveBudgetAction}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-[1fr_160px_120px_auto] sm:items-end">
          <input type="hidden" name="month" value={month} />
          <SelectField
            name="categoryId"
            label={m.finance.budget.category}
            options={categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.label }))}
            error={state.fieldErrors?.categoryId}
          />
          <Field name="amount" label={m.finance.budget.amount} inputMode="decimal" required error={state.fieldErrors?.amount} className="tabular" />
          <SelectField name="currencyCode" label={m.finance.account.currency} defaultValue={defaultCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
          <SubmitButton pendingLabel={m.common.saving}>{m.finance.budget.new}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function DeleteBudgetButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={deleteBudgetAction} fields={{ id }} label={m.finance.budget.delete} pendingLabel={m.common.saving} />;
}

export function GoalForm({
  m,
  currencies,
  defaultCurrency,
  initial,
}: {
  m: Messages;
  currencies: string[];
  defaultCurrency: string;
  initial?: { id: string; name: string; target: string; saved: string; currency: string; targetDate: string | null };
}) {
  return (
    <ActionForm action={saveGoalAction}>
      {(state) => (
        <>
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={m.finance.goal.name} defaultValue={initial?.name} required error={state.fieldErrors?.name} />
            {initial ? (
              <input type="hidden" name="currencyCode" value={initial.currency} />
            ) : (
              <SelectField name="currencyCode" label={m.finance.account.currency} defaultValue={defaultCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
            )}
            <Field name="target" label={m.finance.goal.target} inputMode="decimal" defaultValue={initial?.target} required error={state.fieldErrors?.target} className="tabular" />
            <Field name="saved" label={m.finance.goal.saved} inputMode="decimal" defaultValue={initial?.saved ?? "0"} error={state.fieldErrors?.saved} className="tabular" />
            <Field
              name="targetDate"
              type="date"
              label={m.finance.goal.targetDate}
              optionalLabel={m.common.optional}
              defaultValue={initial?.targetDate ?? ""}
              error={state.fieldErrors?.targetDate}
            />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {initial ? m.finance.goal.update : m.finance.goal.new}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteGoalButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={deleteGoalAction} fields={{ id }} label={m.finance.goal.delete} pendingLabel={m.common.saving} confirmMessage={m.finance.goal.delete} variant="danger" />;
}

export function RecurringForm({
  m,
  accounts,
  categories,
  today,
}: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  return (
    <ActionForm action={saveRecurringAction}>
      {(state) => (
        <>
          <KindToggle m={m} value={kind} onChange={setKind} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="amount" label={m.finance.tx.amount} inputMode="decimal" required error={state.fieldErrors?.amount} className="tabular" />
            <SelectField name="accountId" label={m.finance.tx.account} options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))} error={state.fieldErrors?.accountId} />
            <SelectField
              key={kind}
              name="categoryId"
              label={m.finance.tx.category}
              options={[{ value: "", label: m.finance.tx.noCategory }, ...categories.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.label }))]}
            />
          </div>
          <Field name="description" label={m.finance.tx.description} required maxLength={200} error={state.fieldErrors?.description} />
          <div className="grid gap-4 sm:grid-cols-4">
            <SelectField
              name="frequency"
              label={m.finance.recurring.frequency}
              defaultValue="monthly"
              options={(["weekly", "monthly", "yearly"] as const).map((f) => ({ value: f, label: m.finance.recurring.frequencies[f] }))}
            />
            <Field name="intervalCount" type="number" min={1} max={12} defaultValue="1" label={m.finance.recurring.every} />
            <Field name="startOn" type="date" label={m.finance.recurring.start} defaultValue={today} required error={state.fieldErrors?.startOn} />
            <Field name="endOn" type="date" label={m.finance.recurring.end} optionalLabel={m.common.optional} error={state.fieldErrors?.endOn} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.finance.recurring.new}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RecurringActions({ m, id, active }: { m: Messages; id: string; active: boolean }) {
  return (
    <div className="flex items-start gap-1">
      <InlineAction
        action={toggleRecurringAction}
        fields={{ id, active: active ? "0" : "1" }}
        label={active ? m.finance.recurring.pause : m.finance.recurring.resume}
        pendingLabel={m.common.saving}
      />
      <InlineAction action={deleteRecurringAction} fields={{ id }} label={m.finance.recurring.delete} pendingLabel={m.common.saving} confirmMessage={m.finance.recurring.delete} variant="danger" />
    </div>
  );
}

export function CategoryForm({ m }: { m: Messages }) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  return (
    <ActionForm action={saveCategoryAction}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-[220px_1fr_90px_auto] sm:items-end">
          <KindToggle m={m} value={kind} onChange={setKind} />
          <Field name="name" label={m.finance.category.name} required maxLength={60} error={state.fieldErrors?.name} />
          <Field name="color" type="color" label={m.finance.category.color} defaultValue={kind === "income" ? "#E06A10" : "#5B8DEF"} key={kind} className="p-1" />
          <SubmitButton pendingLabel={m.common.saving}>{m.finance.category.new}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveCategoryButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={archiveCategoryAction} fields={{ id }} label={m.finance.category.archive} pendingLabel={m.common.saving} />;
}
