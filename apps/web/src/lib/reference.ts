import "server-only";
import type { Country, Currency, Language, Region } from "@anen/types";
import type { ServerClient } from "@/lib/supabase/server";

export interface ReferenceData {
  countries: Country[];
  currencies: Currency[];
  languages: Language[];
  regions: Region[];
  timezones: string[];
}

/** Dados de referência a partir da base de dados (fonte de verdade). */
export async function loadReferenceData(supabase: ServerClient): Promise<ReferenceData> {
  const [countries, currencies, languages, regions] = await Promise.all([
    supabase.from("countries").select("*").eq("is_supported", true).order("name"),
    supabase.from("currencies").select("*").eq("is_enabled", true).order("code"),
    supabase.from("languages").select("*").eq("is_enabled", true).order("code"),
    supabase.from("regions").select("*").order("name"),
  ]);
  if (countries.error || currencies.error || languages.error || regions.error) {
    throw new Error("Falha ao carregar dados de referência");
  }
  const regionZones = new Set((regions.data ?? []).map((r) => r.timezone).filter((z): z is string => Boolean(z)));
  const countryZones = new Set((countries.data ?? []).map((c) => c.default_timezone));
  const preferred = [...new Set([...countryZones, ...regionZones])].sort();
  const all = Intl.supportedValuesOf("timeZone").filter((z) => !preferred.includes(z));
  return {
    countries: countries.data ?? [],
    currencies: currencies.data ?? [],
    languages: languages.data ?? [],
    regions: regions.data ?? [],
    timezones: [...preferred, ...all],
  };
}
