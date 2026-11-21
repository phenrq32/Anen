"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import { createProjectFromQuoteAction, deleteProjectAction, saveProjectAction } from "./actions";

export interface ProjectInitial {
  id: string;
  name: string;
  description: string | null;
  clientContactId: string | null;
  status: "planned" | "active" | "completed" | "cancelled";
  currencyCode: string;
  plannedCost: string;
  plannedRevenue: string;
  startOn: string | null;
  endOn: string | null;
  notes: string | null;
  /** A moeda fica bloqueada quando há movimentos ligados. */
  currencyLocked: boolean;
}

export function ProjectForm({
  m,
  clients,
  currencies,
  defaultCurrency,
  initial,
}: {
  m: Messages;
  clients: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
  defaultCurrency: string;
  initial?: ProjectInitial;
}) {
  const t = m.business.projects;
  return (
    <ActionForm action={saveProjectAction}>
      {(state) => (
        <>
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          {initial ? <input type="hidden" name="currencyCode" value={initial.currencyCode} /> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <Field name="name" label={t.name} defaultValue={initial?.name} required maxLength={160} error={state.fieldErrors?.name} />
            <SelectField
              name="status"
              label={t.status}
              defaultValue={initial?.status ?? "active"}
              options={(["planned", "active", "completed", "cancelled"] as const).map((s) => ({ value: s, label: t.statuses[s] }))}
              error={state.fieldErrors?.status}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-description" className="text-sm font-medium">
              {t.descriptionField} <span className="font-normal text-subtle">({m.common.optional})</span>
            </label>
            <textarea
              id="project-description"
              name="description"
              defaultValue={initial?.description ?? ""}
              maxLength={4000}
              rows={3}
              aria-describedby="project-description-hint"
              className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-paper focus:border-brand focus:outline-none"
            />
            <p id="project-description-hint" className="text-xs text-subtle">{t.descriptionHint}</p>
            {state.fieldErrors?.description ? <p className="text-sm text-danger">{state.fieldErrors.description}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <SelectField
              name="clientContactId"
              label={t.client}
              defaultValue={initial?.clientContactId ?? ""}
              options={[{ value: "", label: t.noClient }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              error={state.fieldErrors?.clientContactId}
            />
            {initial ? (
              <Field name="currencyView" label={t.currency} value={initial.currencyCode} disabled readOnly />
            ) : (
              <SelectField
                name="currencyCode"
                label={t.currency}
                defaultValue={defaultCurrency}
                options={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
                error={state.fieldErrors?.currencyCode}
              />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="plannedCost" label={t.plannedCost} inputMode="decimal" autoComplete="off" placeholder="0,00" defaultValue={initial?.plannedCost ?? ""} error={state.fieldErrors?.plannedCost} className="tabular" />
            <Field name="plannedRevenue" label={t.plannedRevenue} inputMode="decimal" autoComplete="off" placeholder="0,00" defaultValue={initial?.plannedRevenue ?? ""} error={state.fieldErrors?.plannedRevenue} className="tabular" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="startOn" type="date" label={t.startOn} optionalLabel={m.common.optional} defaultValue={initial?.startOn ?? ""} error={state.fieldErrors?.startOn} />
            <Field name="endOn" type="date" label={t.endOn} optionalLabel={m.common.optional} defaultValue={initial?.endOn ?? ""} error={state.fieldErrors?.endOn} />
          </div>
          <Field name="notes" label={t.notes} optionalLabel={m.common.optional} defaultValue={initial?.notes ?? ""} maxLength={2000} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {initial ? m.common.save : t.new}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteProjectButton({ m, id }: { m: Messages; id: string }) {
  return (
    <InlineAction
      action={deleteProjectAction}
      fields={{ id }}
      label={m.business.projects.delete}
      pendingLabel={m.common.saving}
      confirmMessage={m.business.projects.deleteConfirm}
      variant="danger"
    />
  );
}

export function CreateProjectFromQuoteButton({ m, quoteId }: { m: Messages; quoteId: string }) {
  return (
    <InlineAction
      action={createProjectFromQuoteAction}
      fields={{ quoteId }}
      label={m.business.projects.createFromQuote}
      pendingLabel={m.common.saving}
      variant="primary"
    />
  );
}
