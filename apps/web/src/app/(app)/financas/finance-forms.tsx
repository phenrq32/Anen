"use client";

import { suggestCategory } from "@/lib/category-memory";
import { useState } from "react";
import { periodRange, type MovementPeriod } from "@anen/validation";
import { format, type Messages } from "@anen/i18n";
import type { TransactionKind } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField, cx } from "@/components/ui";
import {
  archiveCategoryAction,
  archiveCostCenterAction,
  deleteBudgetAction,
  deleteGoalAction,
  deleteRecurringAction,
  deleteTransactionAction,
  saveAccountAction,
  saveBudgetAction,
  saveCategoryAction,
  saveCostCenterAction,
  saveGoalAction,
  saveRecurringAction,
  saveTransactionAction,
  toggleArchiveAccountAction,
  toggleRecurringAction,
  updateRecurringAction,
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
  /** Valor de um período: tipo do período (para editar). */
  period?: MovementPeriod | null;
  accountId: string;
  categoryId: string | null;
  description: string;
  counterparty: string | null;
  notes: string | null;
  contactId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  costKind?: string | null;
  dueOn?: string | null;
  tax?: string | null;
  settlement?: "paid" | "pending" | "partial";
  settled?: string | null;
  paymentMethod?: string | null;
  documentRef?: string | null;
}

/** Opções para ligar o movimento a contacto, projeto e centro de custo (vazias sem permissão). */
export interface TransactionLinks {
  contacts: { id: string; name: string; kind: "client" | "supplier" | "both" }[];
  projects: { id: string; name: string; currency_code: string; status: string }[];
  costCenters: { id: string; name: string }[];
}

const COST_KIND_KEYS = ["material", "labor", "travel", "equipment", "overhead", "other"] as const;
const PAYMENT_METHOD_KEYS = ["transfer", "card", "cash", "direct_debit", "mbway", "pix", "boleto", "check", "other"] as const;
export type Settlement = "paid" | "pending" | "partial";

/** Valores iniciais de um movimento novo (a página "A receber e a pagar" abre já como pendente). */
export interface TransactionDefaults {
  date: string;
  accountId?: string;
  projectId?: string;
  kind?: TransactionKind;
  settlement?: Settlement;
}

function TransactionDetails({
  m,
  kind,
  currency,
  links,
  initial,
  defaultProjectId,
  errors,
}: {
  m: Messages;
  kind: TransactionKind;
  currency: string;
  links: TransactionLinks;
  initial?: TransactionInitial | undefined;
  defaultProjectId?: string | undefined;
  errors?: Record<string, string> | undefined;
}) {
  const hasDetails = Boolean(
    defaultProjectId ||
      initial?.contactId ||
      initial?.projectId ||
      initial?.costCenterId ||
      initial?.costKind ||
      initial?.tax ||
      initial?.paymentMethod ||
      initial?.documentRef,
  );
  const contacts = links.contacts.filter((c) => c.kind === "both" || c.kind === (kind === "income" ? "client" : "supplier"));
  const projects = links.projects.filter(
    (p) => p.currency_code === currency && (p.status === "active" || p.status === "planned" || p.id === initial?.projectId || p.id === defaultProjectId),
  );
  const t = m.finance.tx;
  return (
    <details open={hasDetails} className="group rounded-lg border border-line">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-muted hover:text-paper">
        {t.moreDetails}
        <svg viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">
        {/* Marca que os detalhes vieram no formulário (o registo rápido não os envia e não os altera). */}
        <input type="hidden" name="details" value="1" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            key={`contact-${kind}`}
            name="contactId"
            label={t.contact}
            defaultValue={initial?.contactId ?? ""}
            options={[{ value: "", label: t.noContact }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
            error={errors?.contactId}
          />
          <SelectField
            key={`project-${currency}`}
            name="projectId"
            label={t.project}
            defaultValue={initial?.projectId ?? defaultProjectId ?? ""}
            options={[{ value: "", label: t.noProject }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            hint={currency ? format(m.business.projects.currencyNote, { currency }) : undefined}
            error={errors?.projectId}
          />
          {kind === "expense" ? (
            <SelectField
              name="costKind"
              label={t.costKind}
              defaultValue={initial?.costKind ?? ""}
              options={[{ value: "", label: t.noCostKind }, ...COST_KIND_KEYS.map((k) => ({ value: k, label: m.quotes.line.kinds[k] }))]}
              hint={t.costKindHint}
              error={errors?.costKind}
            />
          ) : null}
          {links.costCenters.length > 0 ? (
            <SelectField
              name="costCenterId"
              label={t.costCenter}
              defaultValue={initial?.costCenterId ?? ""}
              options={[{ value: "", label: t.noCostCenter }, ...links.costCenters.map((c) => ({ value: c.id, label: c.name }))]}
              error={errors?.costCenterId}
            />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="tax"
            label={t.tax}
            optionalLabel={m.common.optional}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            defaultValue={initial?.tax ?? ""}
            hint={t.taxHint}
            error={errors?.tax}
            className="tabular"
          />
          <SelectField
            name="paymentMethod"
            label={t.paymentMethod}
            defaultValue={initial?.paymentMethod ?? ""}
            options={[{ value: "", label: t.noPaymentMethod }, ...PAYMENT_METHOD_KEYS.map((k) => ({ value: k, label: t.paymentMethods[k] }))]}
            error={errors?.paymentMethod}
          />
          <Field name="documentRef" label={t.documentRef} optionalLabel={m.common.optional} defaultValue={initial?.documentRef ?? ""} maxLength={120} error={errors?.documentRef} />
        </div>
      </div>
    </details>
  );
}

/**
 * Estado do pagamento, sempre visível ao lançar (também no registo rápido): já pago, por pagar ou em parte.
 * Por pagar ou em parte fica em "A receber e a pagar", com vencimento opcional.
 */
function SettlementFields({
  m,
  kind,
  initial,
  defaultSettlement,
  errors,
  compact,
}: {
  m: Messages;
  kind: TransactionKind;
  initial?: TransactionInitial | undefined;
  defaultSettlement?: Settlement | undefined;
  errors?: Record<string, string> | undefined;
  compact: boolean;
}) {
  const t = m.finance.tx;
  const [settlement, setSettlement] = useState<Settlement>(initial?.settlement ?? defaultSettlement ?? "paid");
  const labels = t.statusOptions[kind];
  return (
    <div className="flex flex-col gap-2">
      <div className={cx("grid gap-4", compact ? "grid-cols-2" : "sm:grid-cols-3")}>
        <SelectField
          name="settlement"
          label={t.settlement}
          value={settlement}
          onChange={(e) => setSettlement(e.target.value as Settlement)}
          options={(compact ? (["paid", "pending"] as const) : (["paid", "pending", "partial"] as const)).map((k) => ({ value: k, label: labels[k] }))}
          error={errors?.settlement}
        />
        {settlement === "partial" ? (
          <Field
            name="settled"
            label={t.settled}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            defaultValue={initial?.settled ?? ""}
            required
            error={errors?.settled}
            className="tabular"
          />
        ) : null}
        {settlement !== "paid" ? (
          <Field name="dueOn" type="date" label={t.dueOn} optionalLabel={m.common.optional} defaultValue={initial?.dueOn ?? ""} error={errors?.dueOn} />
        ) : null}
      </div>
      {settlement !== "paid" ? <p className="pop-in text-xs text-muted">{t.pendingHint}</p> : null}
    </div>
  );
}

export function TransactionFields({
  m,
  accounts,
  categories,
  defaults,
  initial,
  errors,
  compact = false,
  links,
  memory,
}: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaults: TransactionDefaults;
  initial?: TransactionInitial;
  errors?: Record<string, string> | undefined;
  compact?: boolean;
  links?: TransactionLinks | undefined;
  /** Categoria usada da última vez para cada descrição (lib/category-memory). */
  memory?: Record<string, string> | undefined;
}) {
  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? defaults.kind ?? "expense");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [suggested, setSuggested] = useState(false);
  // A pessoa escolheu a categoria à mão: a memória deixa de mexer nela.
  const [manualCategory, setManualCategory] = useState(Boolean(initial?.categoryId));
  const [description, setDescription] = useState(initial?.description ?? "");
  // Receita de um período ("recebi X esta semana"): "" = um recebimento só.
  const [period, setPeriod] = useState<MovementPeriod | "">(initial?.period ?? "");
  const [refDate, setRefDate] = useState(initial?.occurredOn ?? defaults.date);
  const range = period && /^\d{4}-\d{2}-\d{2}$/.test(refDate) ? periodRange(period, refDate) : null;
  const short = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const suggestFor = (k: TransactionKind, description: string) => {
    if (!memory || manualCategory) return;
    const id = suggestCategory(memory, k, description);
    if (id && categories.some((c) => c.id === id && c.kind === k)) {
      setCategoryId(id);
      setSuggested(true);
    } else if (suggested) {
      setCategoryId("");
      setSuggested(false);
    }
  };
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults.accountId ?? accounts[0]?.id ?? "");
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "";
  const filtered = categories.filter((c) => c.kind === kind);
  return (
    <>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <KindToggle
        m={m}
        value={kind}
        onChange={(k) => {
          setKind(k);
          suggestFor(k, description);
        }}
      />
      {kind === "income" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{m.finance.tx.periodLabel}</legend>
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-ink p-1">
            {(["", "day", "week", "month"] as const).map((p) => (
              <label
                key={p || "single"}
                className={cx(
                  "flex h-9 cursor-pointer items-center justify-center rounded-md px-1 text-center text-xs transition-colors sm:text-sm",
                  period === p ? "bg-graphite font-medium text-paper" : "text-muted hover:text-paper",
                )}
              >
                <input type="radio" name="period" value={p} checked={period === p} onChange={() => setPeriod(p)} className="sr-only" />
                {m.finance.tx.periods[p || "single"]}
              </label>
            ))}
          </div>
          {range ? (
            <p className="pop-in text-xs text-brand">
              {format(m.finance.tx.periodPreview[period as MovementPeriod], { start: short(range.start), end: short(range.end) })}
            </p>
          ) : null}
        </fieldset>
      ) : (
        <input type="hidden" name="period" value="" />
      )}
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
        <Field
          name="occurredOn"
          type="date"
          label={period && kind === "income" ? m.finance.tx.periodDate : m.finance.tx.date}
          value={refDate}
          onChange={(e) => setRefDate(e.target.value)}
          required
          error={errors?.occurredOn}
        />
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
      <SettlementFields
        m={m}
        kind={kind}
        initial={initial}
        defaultSettlement={defaults.settlement}
        errors={errors}
        compact={compact}
      />
      <Field
        name="description"
        label={m.finance.tx.description}
        defaultValue={initial?.description}
        required
        maxLength={200}
        error={errors?.description}
        onChange={(e) => {
          setDescription(e.target.value);
          suggestFor(kind, e.target.value);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <SelectField
            name="categoryId"
            label={m.finance.tx.category}
            value={filtered.some((c) => c.id === categoryId) ? categoryId : ""}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setManualCategory(true);
              setSuggested(false);
            }}
            options={[{ value: "", label: m.finance.tx.noCategory }, ...filtered.map((c) => ({ value: c.id, label: c.label }))]}
            error={errors?.categoryId}
          />
          {suggested ? <p className="pop-in text-xs text-brand">{m.finance.tx.categoryRemembered}</p> : null}
        </div>
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
      {links && !compact ? (
        <TransactionDetails m={m} kind={kind} currency={currency} links={links} initial={initial} defaultProjectId={defaults.projectId} errors={errors} />
      ) : null}
    </>
  );
}

export function TransactionForm(props: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaults: TransactionDefaults;
  initial?: TransactionInitial;
  links?: TransactionLinks;
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

export interface RecurringInitial {
  id: string;
  kind: TransactionKind;
  amount: string;
  currency: string;
  categoryId: string | null;
  description: string;
  endOn: string | null;
  contactId: string | null;
  projectId: string | null;
  costCenterId: string | null;
  costKind: string | null;
  generatePending: boolean;
  dueDays: number | null;
}

/** Ligações, estado e vencimento dos movimentos que a recorrência vai gerar. */
function RecurringExtras({
  m,
  kind,
  currency,
  links,
  initial,
  errors,
}: {
  m: Messages;
  kind: TransactionKind;
  currency: string;
  links: TransactionLinks;
  initial?: RecurringInitial | undefined;
  errors?: Record<string, string> | undefined;
}) {
  const t = m.finance.tx;
  const contacts = links.contacts.filter((c) => c.kind === "both" || c.kind === (kind === "income" ? "client" : "supplier"));
  const projects = links.projects.filter((p) => p.currency_code === currency && (p.status === "active" || p.status === "planned" || p.id === initial?.projectId));
  const hasDetails = Boolean(initial && (initial.contactId || initial.projectId || initial.costCenterId || initial.costKind || initial.generatePending || initial.dueDays !== null));
  return (
    <details open={hasDetails} className="group rounded-lg border border-line">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-muted hover:text-paper">
        {t.moreDetails}
        <svg viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            key={`rc-${kind}`}
            name="contactId"
            label={t.contact}
            defaultValue={initial?.contactId ?? ""}
            options={[{ value: "", label: t.noContact }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
            error={errors?.contactId}
          />
          <SelectField
            key={`rp-${currency}`}
            name="projectId"
            label={t.project}
            defaultValue={initial?.projectId ?? ""}
            options={[{ value: "", label: t.noProject }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            hint={currency ? format(m.business.projects.currencyNote, { currency }) : undefined}
            error={errors?.projectId}
          />
          {kind === "expense" ? (
            <SelectField
              name="costKind"
              label={t.costKind}
              defaultValue={initial?.costKind ?? ""}
              options={[{ value: "", label: t.noCostKind }, ...COST_KIND_KEYS.map((k) => ({ value: k, label: m.quotes.line.kinds[k] }))]}
              error={errors?.costKind}
            />
          ) : null}
          {links.costCenters.length > 0 ? (
            <SelectField
              name="costCenterId"
              label={t.costCenter}
              defaultValue={initial?.costCenterId ?? ""}
              options={[{ value: "", label: t.noCostCenter }, ...links.costCenters.map((c) => ({ value: c.id, label: c.name }))]}
              error={errors?.costCenterId}
            />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="generatePending" value="1" defaultChecked={initial?.generatePending ?? false} className="size-4 accent-[#FF851B]" />
            {m.finance.recurring.generatePending}
          </label>
          <Field
            name="dueDays"
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            label={m.finance.recurring.dueDays}
            optionalLabel={m.common.optional}
            defaultValue={initial?.dueDays ?? ""}
            error={errors?.dueDays}
          />
        </div>
      </div>
    </details>
  );
}

export function RecurringForm({
  m,
  accounts,
  categories,
  today,
  links,
}: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  links: TransactionLinks;
}) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "";
  return (
    <ActionForm action={saveRecurringAction}>
      {(state) => (
        <>
          <KindToggle m={m} value={kind} onChange={setKind} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="amount" label={`${m.finance.tx.amount}${currency ? ` (${currency})` : ""}`} inputMode="decimal" required error={state.fieldErrors?.amount} className="tabular" />
            <SelectField
              name="accountId"
              label={m.finance.tx.account}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
              error={state.fieldErrors?.accountId}
            />
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
          <RecurringExtras m={m} kind={kind} currency={currency} links={links} errors={state.fieldErrors} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.finance.recurring.new}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RecurringEditForm({
  m,
  categories,
  links,
  initial,
}: {
  m: Messages;
  categories: CategoryOption[];
  links: TransactionLinks;
  initial: RecurringInitial;
}) {
  return (
    <ActionForm action={updateRecurringAction}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <p className="text-sm text-muted">{m.finance.recurring.editHint}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              name="amount"
              label={`${m.finance.tx.amount} (${initial.currency})`}
              inputMode="decimal"
              defaultValue={initial.amount}
              required
              error={state.fieldErrors?.amount}
              className="tabular"
            />
            <SelectField
              name="categoryId"
              label={m.finance.tx.category}
              defaultValue={initial.categoryId ?? ""}
              options={[{ value: "", label: m.finance.tx.noCategory }, ...categories.filter((c) => c.kind === initial.kind).map((c) => ({ value: c.id, label: c.label }))]}
              error={state.fieldErrors?.categoryId}
            />
            <Field name="endOn" type="date" label={m.finance.recurring.end} optionalLabel={m.common.optional} defaultValue={initial.endOn ?? ""} error={state.fieldErrors?.endOn} />
          </div>
          <Field name="description" label={m.finance.tx.description} defaultValue={initial.description} required maxLength={200} error={state.fieldErrors?.description} />
          <RecurringExtras m={m} kind={initial.kind} currency={initial.currency} links={links} initial={initial} errors={state.fieldErrors} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RecurringActions({ m, id, active }: { m: Messages; id: string; active: boolean }) {
  return (
    <div className="flex items-start gap-1">
      <a href={`/financas/recorrentes?editar=${id}`} className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted hover:bg-graphite hover:text-paper">
        {m.finance.recurring.edit}
      </a>
      <InlineAction
        action={toggleRecurringAction}
        fields={{ id, active: active ? "0" : "1" }}
        label={active ? m.finance.recurring.pause : m.finance.recurring.resume}
        pendingLabel={m.common.saving}
      />
      <InlineAction
        action={deleteRecurringAction}
        fields={{ id }}
        label={m.finance.recurring.delete}
        pendingLabel={m.common.saving}
        confirmMessage={m.finance.recurring.deleteConfirm}
        variant="danger"
      />
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

export function CostCenterForm({ m }: { m: Messages }) {
  return (
    <ActionForm action={saveCostCenterAction}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field name="name" label={m.finance.costCenters.name} required maxLength={80} error={state.fieldErrors?.name} />
          <SubmitButton pendingLabel={m.common.saving}>{m.finance.costCenters.new}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveCostCenterButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={archiveCostCenterAction} fields={{ id }} label={m.finance.costCenters.archive} pendingLabel={m.common.saving} />;
}
