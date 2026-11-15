"use server";

import { redirect } from "next/navigation";
import { fieldErrors, onboardingSchema } from "@anen/validation";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n, setLocaleCookie } from "@/lib/i18n";
import { requireSession } from "@/lib/session";

export async function completeOnboardingAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireSession();
  const parsed = onboardingSchema.safeParse({
    fullName: formString(formData, "fullName"),
    accountType: formString(formData, "accountType"),
    countryCode: formString(formData, "countryCode"),
    languageCode: formString(formData, "languageCode"),
    currencyCode: formString(formData, "currencyCode"),
    timezone: formString(formData, "timezone"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const input = parsed.data;

  const prefs = await session.supabase
    .from("user_preferences")
    .update({
      country_code: input.countryCode,
      language_code: input.languageCode,
      currency_code: input.currencyCode,
      timezone: input.timezone,
    })
    .eq("user_id", session.user.id);
  if (prefs.error) return { status: "error", message: errorMessage(m, prefs.error) };

  const profile = await session.supabase
    .from("users_profiles")
    .update({ full_name: input.fullName, primary_account_type: input.accountType, onboarded_at: new Date().toISOString() })
    .eq("id", session.user.id);
  if (profile.error) return { status: "error", message: errorMessage(m, profile.error) };

  await setLocaleCookie(input.languageCode);
  if (input.accountType === "independent" || input.accountType === "business") {
    redirect(`/organizacoes/nova?tipo=${input.accountType}`);
  }
  redirect("/painel");
}
