"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { format } from "@anen/i18n";
import {
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "@anen/validation";
import { getPublicEnv } from "@/lib/env";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

/**
 * URL base dos links enviados por email. Em produção usa sempre NEXT_PUBLIC_SITE_URL:
 * confiar no cabeçalho Host permitiria envenenar links de recuperação de palavra-passe.
 */
async function siteUrl(): Promise<string> {
  const env = getPublicEnv();
  if (process.env.NODE_ENV === "production" || (env?.siteUrl && !env.siteUrl.includes("localhost"))) {
    return env?.siteUrl ?? "http://localhost:3000";
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : (env?.siteUrl ?? "http://localhost:3000");
}

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const parsed = signInSchema.safeParse({ email: formString(formData, "email"), password: formString(formData, "password") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "invalid_credentials") return { status: "error", message: m.auth.signIn.invalidCredentials };
    if (error.code === "email_not_confirmed") return { status: "error", message: m.auth.signIn.emailNotConfirmed };
    return { status: "error", message: errorMessage(m, error) };
  }
  redirect(safeNextPath(formString(formData, "next")));
}

export async function signUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, locale } = await getI18n();
  const parsed = signUpSchema.safeParse({
    fullName: formString(formData, "fullName"),
    email: formString(formData, "email"),
    password: formString(formData, "password"),
    acceptTerms: formData.get("acceptTerms") === "on",
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const next = safeNextPath(formString(formData, "next"), "/boas-vindas");
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
      data: { full_name: parsed.data.fullName, locale },
    },
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  // O Supabase responde da mesma forma para emails já registados (evita enumeração de contas).
  return { status: "success", message: format(m.auth.signUp.checkEmailBody, { email: parsed.data.email }) };
}

export async function forgotPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const parsed = forgotPasswordSchema.safeParse({ email: formString(formData, "email") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/nova-senha`,
  });
  if (error && error.status === 429) return { status: "error", message: m.errors.rateLimited };
  // Resposta idêntica exista ou não a conta.
  return { status: "success", message: format(m.auth.forgot.sentBody, { email: parsed.data.email }) };
}

export async function resetPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const parsed = resetPasswordSchema.safeParse({
    password: formString(formData, "password"),
    confirmPassword: formString(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { status: "error", message: m.auth.reset.expired };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: errorMessage(m, error) };
  redirect("/painel");
}

export async function signInWithGoogleAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const env = getPublicEnv();
  if (!env?.googleAuthEnabled) return { status: "error", message: m.errors.generic };
  const supabase = await createClient();
  const next = safeNextPath(formString(formData, "next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) return { status: "error", message: errorMessage(m, error) };
  redirect(data.url);
}
