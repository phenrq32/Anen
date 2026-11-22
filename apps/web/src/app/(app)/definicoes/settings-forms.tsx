"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LocaleFields } from "@/components/locale-fields";
import { Field } from "@/components/ui";
import type { ReferenceData } from "@/lib/reference";
import { updateHiddenModulesAction, updatePreferencesAction, updateProfileAction } from "../actions";
import { OPTIONAL_MODULES, type OptionalModule } from "@/lib/modules";

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

/** Áreas do menu: marcar = aparece no menu e na procura. */
export function ModulesForm({ m, hidden, labels }: { m: Messages; hidden: string[]; labels: Record<OptionalModule, string> }) {
  const t = m.settings.modules;
  return (
    <ActionForm action={updateHiddenModulesAction}>
      {() => (
        <div className="flex flex-col gap-4">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">{t.title}</legend>
            {OPTIONAL_MODULES.map((k) => (
              <label key={k} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border glass spot px-4 py-3 hover:border-brand/40">
                <input type="checkbox" name="visible" value={k} defaultChecked={!hidden.includes(k)} className="mt-0.5 size-5 shrink-0 accent-[#FF851B]" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{labels[k]}</span>
                  <span className="text-xs text-subtle">{t.hints[k]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-subtle">{t.note}</p>
          <SubmitButton pendingLabel={m.common.saving} variant="secondary" className="self-start">
            {t.save}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
