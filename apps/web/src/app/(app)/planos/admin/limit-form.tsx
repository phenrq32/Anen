"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, SelectField } from "@/components/ui";
import { PLAN_LIMIT_KEYS } from "@/lib/plan-limits";
import { setPlanLimitAction } from "./limit-actions";

export function PlanLimitForm({ m, plans }: { m: Messages; plans: { key: string; name: string }[] }) {
  const t = m.billing.limits;
  return (
    <ActionForm action={setPlanLimitAction}>
      {(state) => (
        <>
          {state.status === "success" && state.message ? <Alert tone="success">{state.message}</Alert> : null}
          {state.status === "error" && state.message ? <Alert>{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="plan" label={t.plan} options={plans.map((p) => ({ value: p.key, label: p.name }))} />
            <SelectField name="key" label={t.key} options={PLAN_LIMIT_KEYS.map((k) => ({ value: k, label: t.keys[k] }))} />
            <Field name="value" label={t.value} inputMode="numeric" className="tabular" />
            <Field name="source" label={t.source} required maxLength={300} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
