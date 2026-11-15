import { z } from "zod";
import { ACCOUNT_TYPES, ORGANIZATION_KINDS, PERMISSION_KEYS, SUPPORTED_LOCALES } from "@anen/types";
import { isValidOrganizationTaxId, normalizeTaxId } from "./tax-ids";

/**
 * As mensagens de erro são chaves de tradução (ver @anen/i18n → errors.*),
 * para que web e mobile apresentem o texto no idioma do utilizador.
 */

const trimmed = (max: number) => z.string().trim().max(max, { message: "too_long" });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { message: "too_long" })
  .pipe(z.email({ message: "email_invalid" }));

/** Mínimo de 10 caracteres; máximo de 72 (limite do bcrypt usado pelo Supabase Auth). */
export const passwordSchema = z
  .string()
  .min(10, { message: "password_too_short" })
  .max(72, { message: "password_too_long" })
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: "password_weak" });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: "name_required" })
  .max(120, { message: "too_long" });

export const signUpSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: "terms_required" }),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "password_required" }).max(72, { message: "password_too_long" }),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "passwords_mismatch", path: ["confirmPassword"] });

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, { message: "country_invalid" });
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, { message: "currency_invalid" });
const timeZoneSchema = z.string().min(1).max(64).refine(isValidTimeZone, { message: "timezone_invalid" });

export const preferencesSchema = z.object({
  countryCode: countryCodeSchema,
  languageCode: z.enum(SUPPORTED_LOCALES, { message: "language_invalid" }),
  currencyCode: currencyCodeSchema,
  timezone: timeZoneSchema,
});

export const profileSchema = z.object({ fullName: fullNameSchema });

export const onboardingSchema = preferencesSchema.extend({
  fullName: fullNameSchema,
  accountType: z.enum(ACCOUNT_TYPES, { message: "account_type_invalid" }),
});

const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const organizationSchema = z
  .object({
    kind: z.enum(ORGANIZATION_KINDS, { message: "organization_kind_invalid" }),
    name: z.string().trim().min(2, { message: "name_required" }).max(120, { message: "too_long" }),
    legalName: optionalText(200),
    taxId: optionalText(32),
    countryCode: countryCodeSchema,
    regionId: z
      .union([z.uuid({ message: "region_invalid" }), z.literal("")])
      .optional()
      .transform((v) => (v ? v : null)),
    currencyCode: currencyCodeSchema,
    timezone: timeZoneSchema,
  })
  .transform((v) => ({ ...v, taxId: v.taxId ? normalizeTaxId(v.taxId) : null }))
  .refine((v) => v.taxId === null || isValidOrganizationTaxId(v.countryCode, v.taxId), {
    message: "tax_id_invalid",
    path: ["taxId"],
  });

export const invitationSchema = z.object({
  organizationId: z.uuid(),
  email: emailSchema,
  roleId: z.uuid({ message: "role_invalid" }),
});

export const memberUpdateSchema = z.object({
  memberId: z.uuid(),
  roleId: z.uuid({ message: "role_invalid" }),
});

export const roleSchema = z.object({
  organizationId: z.uuid(),
  roleId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  name: z.string().trim().min(2, { message: "name_required" }).max(60, { message: "too_long" }),
  description: optionalText(200),
  permissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length),
});

/** Converte um erro Zod num mapa campo → chave de erro (primeiro erro de cada campo). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type OrganizationInput = z.infer<typeof organizationSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
