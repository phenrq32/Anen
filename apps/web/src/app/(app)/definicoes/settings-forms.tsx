"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LocaleFields } from "@/components/locale-fields";
import { Field } from "@/components/ui";
import type { ReferenceData } from "@/lib/reference";
import { updatePreferencesAction, updateProfileAction } from "../actions";

export function ProfileForm({ m, fullName, email }: { m: Messages; fullName: string; email: string }) {
  return (
    <ActionForm action={updateProfileAction}>
      {(state) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field name="fullName" label={m.onboarding.fullName} defaultValue={fullName} autoComplete="name" error={state.fieldErrors?.fullName} />
            <Field name="email" label={m.settings.accountEmail} value={email} readOnly disabled />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function PreferencesForm({
  m,
  reference,
  defaults,
}: {
  m: Messages;
  reference: ReferenceData;
  defaults: { countryCode: string; languageCode: string; currencyCode: string; timezone: string };
}) {
  return (
    <ActionForm action={updatePreferencesAction}>
      {(state) => (
        <>
          <LocaleFields
            m={m}
            countries={reference.countries}
            currencies={reference.currencies}
            languages={reference.languages}
            timezones={reference.timezones}
            defaults={defaults}
            errors={state.fieldErrors}
          />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
