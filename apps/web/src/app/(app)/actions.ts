"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { format } from "@anen/i18n";
import {
  fieldErrors,
  invitationSchema,
  memberUpdateSchema,
  organizationSchema,
  preferencesSchema,
  profileSchema,
  roleSchema,
} from "@anen/validation";
import { getPublicEnv } from "@/lib/env";
import { OPTIONAL_MODULES } from "@/lib/modules";
import { errorMessage, translateFieldErrors } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n, setLocaleCookie } from "@/lib/i18n";
import { requireOnboardedSession, requireSession } from "@/lib/session";

const ok = (message?: string, data?: Record<string, string>): FormState => ({
  status: "success",
  ...(message ? { message } : {}),
  ...(data ? { data } : {}),
});

export async function switchContextAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const value = formString(formData, "context");
  const target = value === "personal" ? null : session.memberships.find((x) => x.organization.id === value)?.organization.id;
  if (target === undefined) redirect("/painel");
  await session.supabase.from("user_preferences").update({ active_organization_id: target }).eq("user_id", session.user.id);
  revalidatePath("/", "layout");
  redirect("/painel");
}

export async function createOrganizationAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const parsed = organizationSchema.safeParse({
    kind: formString(formData, "kind"),
    name: formString(formData, "name"),
    legalName: formString(formData, "legalName"),
    taxId: formString(formData, "taxId"),
    countryCode: formString(formData, "countryCode"),
    regionId: formString(formData, "regionId"),
    currencyCode: formString(formData, "currencyCode"),
    timezone: formString(formData, "timezone"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { error } = await session.supabase.rpc("create_organization", {
    p_kind: v.kind,
    p_name: v.name,
    p_country_code: v.countryCode,
    p_currency_code: v.currencyCode,
    p_timezone: v.timezone,
    p_legal_name: v.legalName,
    p_tax_id: v.taxId,
    p_region_id: v.regionId,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  redirect("/painel");
}

export async function updateOrganizationAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const org = session.active?.organization;
  if (!org) return { status: "error", message: m.errors.forbidden };
  const parsed = organizationSchema.safeParse({
    kind: org.kind,
    countryCode: org.country_code,
    name: formString(formData, "name"),
    legalName: formString(formData, "legalName"),
    taxId: formString(formData, "taxId"),
    regionId: formString(formData, "regionId"),
    currencyCode: formString(formData, "currencyCode"),
    timezone: formString(formData, "timezone"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { data, error } = await session.supabase
    .from("organizations")
    .update({ name: v.name, legal_name: v.legalName, tax_id: v.taxId, region_id: v.regionId, currency_code: v.currencyCode, timezone: v.timezone })
    .eq("id", org.id)
    .select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/", "layout");
  return ok(m.organization.updated);
}

export async function updateProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireSession();
  const parsed = profileSchema.safeParse({ fullName: formString(formData, "fullName") });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { error } = await session.supabase.from("users_profiles").update({ full_name: parsed.data.fullName }).eq("id", session.user.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  return ok(m.settings.saved);
}

export async function updatePreferencesAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = preferencesSchema.safeParse({
    countryCode: formString(formData, "countryCode"),
    languageCode: formString(formData, "languageCode"),
    currencyCode: formString(formData, "currencyCode"),
    timezone: formString(formData, "timezone"),
  });
  const { m } = await getI18n();
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { error } = await session.supabase
    .from("user_preferences")
    .update({ country_code: v.countryCode, language_code: v.languageCode, currency_code: v.currencyCode, timezone: v.timezone })
    .eq("user_id", session.user.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  await setLocaleCookie(v.languageCode);
  revalidatePath("/", "layout");
  const { m: updated } = await getI18n();
  return ok(updated.settings.saved);
}

/** Áreas do menu: as que NÃO vêm marcadas ficam escondidas (só o menu e a procura mudam). */
export async function updateHiddenModulesAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const { m } = await getI18n();
  const visible = new Set(formData.getAll("visible").map(String));
  const hidden = OPTIONAL_MODULES.filter((k) => !visible.has(k));
  const { error } = await session.supabase.from("user_preferences").update({ hidden_modules: hidden }).eq("user_id", session.user.id);
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  return ok(m.settings.modules.saved);
}

export async function inviteMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const parsed = invitationSchema.safeParse({
    organizationId: session.active?.organization.id,
    email: formString(formData, "email"),
    roleId: formString(formData, "roleId"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const { data, error } = await session.supabase.rpc("invite_member", {
    p_organization_id: parsed.data.organizationId,
    p_email: parsed.data.email,
    p_role_id: parsed.data.roleId,
  });
  const invitation = data?.[0];
  if (error || !invitation) return { status: "error", message: errorMessage(m, error) };
  const base = getPublicEnv()?.siteUrl ?? "";
  revalidatePath("/organizacao/membros");
  return ok(format(m.members.inviteCreated, { email: parsed.data.email }), {
    link: `${base}/convite/${invitation.token}`,
  });
}

export async function revokeInvitationAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { error } = await session.supabase.rpc("revoke_invitation", { p_invitation_id: formString(formData, "invitationId") });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/organizacao/membros");
  return ok();
}

export async function updateMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const parsed = memberUpdateSchema.safeParse({ memberId: formString(formData, "memberId"), roleId: formString(formData, "roleId") });
  const status = formString(formData, "status") === "suspended" ? "suspended" : "active";
  if (!parsed.success) return { status: "error", message: m.errors.role_invalid };
  const { error } = await session.supabase.rpc("update_member", {
    p_member_id: parsed.data.memberId,
    p_role_id: parsed.data.roleId,
    p_status: status,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/organizacao/membros");
  return ok(m.settings.saved);
}

export async function removeMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const memberId = formString(formData, "memberId");
  const { error } = await session.supabase.rpc("remove_member", { p_member_id: memberId });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  if (session.active?.memberId === memberId) redirect("/painel");
  return ok();
}

export async function saveRoleAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const parsed = roleSchema.safeParse({
    organizationId: session.active?.organization.id,
    roleId: formString(formData, "roleId"),
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    permissions: formData.getAll("permissions").filter((v): v is string => typeof v === "string"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: translateFieldErrors(m, fieldErrors(parsed.error)) };
  const v = parsed.data;
  const { error } = await session.supabase.rpc("upsert_role", {
    p_organization_id: v.organizationId,
    p_name: v.name,
    p_permissions: v.permissions,
    p_description: v.description,
    p_role_id: v.roleId,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/organizacao/funcoes");
  return ok(m.settings.saved);
}

export async function deleteRoleAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { error } = await session.supabase.rpc("delete_role", { p_role_id: formString(formData, "roleId") });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/organizacao/funcoes");
  return ok();
}

export async function acceptInvitationAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireSession();
  const { error } = await session.supabase.rpc("accept_invitation", { p_token: formString(formData, "token") });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  redirect(session.profile.onboarded_at ? "/painel" : "/boas-vindas");
}
