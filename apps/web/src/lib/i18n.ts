import "server-only";
import { cookies, headers } from "next/headers";
import { getMessages, isLocale, localeFromAcceptLanguage, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";

export const LOCALE_COOKIE = "anen-locale";

/** Idioma: cookie (definido a partir das preferências do utilizador) → Accept-Language → pt-PT. */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie) && (fromCookie === "pt-PT" || fromCookie === "pt-BR")) return fromCookie;
  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language"));
}

export async function getI18n(): Promise<{ locale: Locale; m: Messages }> {
  const locale = await getLocale();
  return { locale, m: getMessages(locale) };
}

export async function setLocaleCookie(locale: Locale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
