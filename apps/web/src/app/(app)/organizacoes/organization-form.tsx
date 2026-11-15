"use client";

import { useState } from "react";
import type { Messages } from "@anen/i18n";
import { ORGANIZATION_KINDS, type Organization, type OrganizationKind } from "@anen/types";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, SelectField, cx } from "@/components/ui";
import type { ReferenceData } from "@/lib/reference";

export function OrganizationForm({
  m,
  reference,
  action,
  mode,
  initial,
  defaultKind,
  defaults,
  readOnly = false,
}: {
  m: Messages;
  reference: ReferenceData;
  action: FormAction;
  mode: "create" | "edit";
  initial?: Organization;
  defaultKind?: OrganizationKind;
  defaults: { countryCode: string; currencyCode: string; timezone: string };
  readOnly?: boolean;
}) {
  const [country, setCountry] = useState(initial?.country_code ?? defaults.countryCode);
  const [currency, setCurrency] = useState(initial?.currency_code ?? defaults.currencyCode);
  const [timezone, setTimezone] = useState(initial?.timezone ?? defaults.timezone);
  const [regionId, setRegionId] = useState(initial?.region_id ?? "");
  const regions = reference.regions.filter((r) => r.country_code === country);
  const taxHint = country === "PT" ? m.organization.taxIdHint.PT : country === "BR" ? m.organization.taxIdHint.BR : undefined;

  return (
    <ActionForm action={action} className="gap-6">
      {(state) => (
        <fieldset disabled={readOnly} className="flex flex-col gap-6 disabled:opacity-80">
          {mode === "create" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium">{m.organization.kind}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {ORGANIZATION_KINDS.map((kind) => (
                  <label
                    key={kind}
                    className={cx(
                      "relative flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface p-4 transition-colors",
                      "hover:border-graphite-soft has-[:checked]:border-brand has-[:checked]:bg-brand/[0.06]",
                    )}
                  >
                    <input type="radio" name="kind" value={kind} defaultChecked={(defaultKind ?? "business") === kind} className="sr-only" />
                    <span className="font-semibold">{m.organization.kinds[kind].label}</span>
                    <span className="text-sm text-muted">{m.organization.kinds[kind].description}</span>
                  </label>
                ))}
              </div>
              {state.fieldErrors?.kind ? <p className="text-[13px] text-danger">{state.fieldErrors.kind}</p> : null}
            </fieldset>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field name="name" label={m.organization.name} defaultValue={initial?.name ?? ""} required error={state.fieldErrors?.name} />
            <Field
              name="legalName"
              label={m.organization.legalName}
              optionalLabel={m.common.optional}
              defaultValue={initial?.legal_name ?? ""}
              error={state.fieldErrors?.legalName}
            />
            {mode === "create" ? (
              <SelectField
                name="countryCode"
                label={m.organization.country}
                value={country}
                onChange={(e) => {
                  const next = reference.countries.find((c) => c.code === e.target.value);
                  setCountry(e.target.value);
                  setRegionId("");
                  if (next) {
                    setCurrency(next.default_currency_code);
                    setTimezone(next.default_timezone);
                  }
                }}
                options={reference.countries.map((c) => ({ value: c.code, label: c.name }))}
                error={state.fieldErrors?.countryCode}
              />
            ) : (
              <Field name="countryDisplay" label={m.organization.country} value={reference.countries.find((c) => c.code === country)?.name ?? country} readOnly disabled />
            )}
            <SelectField
              name="regionId"
              label={m.organization.region}
              optionalLabel={m.common.optional}
              value={regionId}
              onChange={(e) => {
                setRegionId(e.target.value);
                const zone = reference.regions.find((r) => r.id === e.target.value)?.timezone;
                if (zone) setTimezone(zone);
              }}
              options={[{ value: "", label: m.organization.regionNone }, ...regions.map((r) => ({ value: r.id, label: r.name }))]}
              error={state.fieldErrors?.regionId}
            />
            <Field
              name="taxId"
              label={m.organization.taxId}
              optionalLabel={m.common.optional}
              defaultValue={initial?.tax_id ?? ""}
              hint={taxHint}
              autoComplete="off"
              error={state.fieldErrors?.taxId}
            />
            <SelectField
              name="currencyCode"
              label={m.organization.currency}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={reference.currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
              error={state.fieldErrors?.currencyCode}
            />
            <SelectField
              name="timezone"
              label={m.organization.timezone}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              options={reference.timezones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))}
              error={state.fieldErrors?.timezone}
            />
          </div>
          <p className="text-[13px] text-subtle">{m.organization.taxIdNotVerified}</p>
          {readOnly ? null : (
            <SubmitButton pendingLabel={m.common.saving} className="self-start px-6">
              {mode === "create" ? m.organization.submit : m.common.save}
            </SubmitButton>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
