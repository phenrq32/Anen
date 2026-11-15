"use client";

import type { Messages } from "@anen/i18n";
import { ACCOUNT_TYPES, type AccountType } from "@anen/types";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LocaleFields } from "@/components/locale-fields";
import { Field, cx } from "@/components/ui";
import type { ReferenceData } from "@/lib/reference";
import { completeOnboardingAction } from "./actions";

export function OnboardingForm({
  m,
  reference,
  defaults,
}: {
  m: Messages;
  reference: ReferenceData;
  defaults: { fullName: string; accountType: AccountType | null; countryCode: string; languageCode: string; currencyCode: string; timezone: string };
}) {
  return (
    <ActionForm action={completeOnboardingAction} className="gap-8">
      {(state) => (
        <>
          <Field name="fullName" label={m.onboarding.fullName} defaultValue={defaults.fullName} autoComplete="name" error={state.fieldErrors?.fullName} />

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">{m.onboarding.accountType}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ACCOUNT_TYPES.map((type) => (
                <label
                  key={type}
                  className={cx(
                    "group relative flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface p-4 transition-colors",
                    "hover:border-graphite-soft has-[:checked]:border-brand has-[:checked]:bg-brand/[0.06]",
                  )}
                >
                  <input type="radio" name="accountType" value={type} defaultChecked={defaults.accountType === type} className="peer sr-only" />
                  <span className="font-semibold">{m.onboarding.accountTypes[type].label}</span>
                  <span className="text-sm text-muted">{m.onboarding.accountTypes[type].description}</span>
                  <span className="absolute right-4 top-4 size-4 rounded-full border border-graphite-soft peer-checked:border-[5px] peer-checked:border-brand" aria-hidden />
                </label>
              ))}
            </div>
            {state.fieldErrors?.accountType ? <p className="text-[13px] text-danger">{state.fieldErrors.accountType}</p> : null}
            <p className="text-[13px] text-subtle">{m.onboarding.accountTypeNote}</p>
          </fieldset>

          <LocaleFields
            m={m}
            countries={reference.countries}
            currencies={reference.currencies}
            languages={reference.languages}
            timezones={reference.timezones}
            defaults={defaults}
            errors={state.fieldErrors}
          />

          <SubmitButton pendingLabel={m.common.saving} className="self-start px-6">
            {m.onboarding.submit}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
