import type { Locale } from "@anen/types";
import { SUPPORTED_LOCALES } from "@anen/types";
import { ptPT, type Messages } from "./messages/pt-PT";
import { ptBR } from "./messages/pt-BR";

export type { Messages };

/** Idiomas com tradução completa. en e es estão preparados mas ainda usam pt-PT como fallback. */
export const ENABLED_LOCALES = ["pt-PT", "pt-BR"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = "pt-PT";

const catalog: Partial<Record<Locale, Messages>> = {
  "pt-PT": ptPT,
  "pt-BR": ptBR,
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return catalog[locale] ?? ptPT;
}

/** Substitui {chave} pelos valores indicados. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

/**
 * Procura uma tradução por chave dinâmica (ex.: vinda da base de dados) sem aceitar
 * propriedades herdadas como "constructor" ou "toString".
 */
export function lookup<T extends Record<string, string>>(dictionary: T, key: string): string | undefined {
  return Object.hasOwn(dictionary, key) ? dictionary[key as keyof T] : undefined;
}

/** Escolhe o idioma a partir do cabeçalho Accept-Language, entre os idiomas ativos. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag === "pt-br") return "pt-BR";
    if (tag === "pt-pt" || tag === "pt") return "pt-PT";
  }
  return DEFAULT_LOCALE;
}

/** Formata um valor em unidades mínimas como moeda, sem passar por ponto flutuante. */
export function formatMoney(amountMinor: bigint, currency: string, minorUnit: number, locale: Locale): string {
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(minorUnit + 1, "0");
  const decimalString =
    minorUnit === 0 ? digits : `${digits.slice(0, -minorUnit)}.${digits.slice(-minorUnit)}`;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  });
  return formatter.format(`${negative ? "-" : ""}${decimalString}` as Intl.StringNumericLiteral);
}

export function formatDate(
  value: Date | string,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
    typeof value === "string" ? new Date(value) : value,
  );
}
