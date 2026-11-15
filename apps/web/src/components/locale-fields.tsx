"use client";

import { useState } from "react";
import type { Messages } from "@anen/i18n";
import type { Country, Currency, Language } from "@anen/types";
import { SelectField } from "@/components/ui";

/**
 * País, idioma, moeda e fuso horário: independentes entre si.
 * Ao mudar o país sugerem-se os valores por omissão desse país, sem os impor.
 */
export function LocaleFields({
  m,
  countries,
  currencies,
  languages,
  timezones,
  defaults,
  errors,
}: {
  m: Messages;
  countries: Country[];
  currencies: Currency[];
  languages: Language[];
  timezones: string[];
  defaults: { countryCode: string; languageCode: string; currencyCode: string; timezone: string };
  errors?: Record<string, string> | undefined;
}) {
  const [values, setValues] = useState(defaults);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <SelectField
        name="countryCode"
        label={m.onboarding.country}
        value={values.countryCode}
        onChange={(e) => {
          const country = countries.find((c) => c.code === e.target.value);
          setValues((v) =>
            country
              ? {
                  countryCode: country.code,
                  languageCode: country.default_language_code,
                  currencyCode: country.default_currency_code,
                  timezone: country.default_timezone,
                }
              : { ...v, countryCode: e.target.value },
          );
        }}
        options={countries.map((c) => ({ value: c.code, label: c.name }))}
        error={errors?.countryCode}
      />
      <SelectField
        name="languageCode"
        label={m.onboarding.language}
        value={values.languageCode}
        onChange={(e) => setValues((v) => ({ ...v, languageCode: e.target.value }))}
        options={languages.map((l) => ({ value: l.code, label: l.native_name }))}
        error={errors?.languageCode}
      />
      <SelectField
        name="currencyCode"
        label={m.onboarding.currency}
        value={values.currencyCode}
        onChange={(e) => setValues((v) => ({ ...v, currencyCode: e.target.value }))}
        options={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
        error={errors?.currencyCode}
      />
      <SelectField
        name="timezone"
        label={m.onboarding.timezone}
        value={values.timezone}
        onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
        options={timezones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))}
        error={errors?.timezone}
      />
    </div>
  );
}
