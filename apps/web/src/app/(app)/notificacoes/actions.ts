"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NOTIFICATION_KINDS, type NotificationKind } from "@anen/types";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { safeNotificationLink } from "@/lib/notifications";
import { requireOnboardedSession } from "@/lib/session";

const UUID = /^[0-9a-f-]{36}$/;

/** Marca como lida e abre o destino; se for de outro contexto (pessoal/organização), muda primeiro para ele. */
export async function openNotificationAction(formData: FormData): Promise<void> {
  const session = await requireOnboardedSession();
  const id = formString(formData, "id");
  if (!UUID.test(id)) redirect("/notificacoes");
  const { data } = await session.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("organization_id, link");
  const n = data?.[0];
  if (!n) redirect("/notificacoes");
  const current = session.active?.organization.id ?? null;
  if (n.organization_id !== current) {
    const allowed = n.organization_id === null || session.memberships.some((x) => x.organization.id === n.organization_id);
    if (allowed) {
      await session.supabase.from("user_preferences").update({ active_organization_id: n.organization_id }).eq("user_id", session.user.id);
    }
  }
  revalidatePath("/", "layout");
  redirect(safeNotificationLink(n.link));
}

export async function markNotificationReadAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { error } = await session.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", formString(formData, "id"))
    .is("read_at", null);
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  return { status: "success" };
}

export async function markAllNotificationsReadAction(_: FormState): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { error } = await session.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  return { status: "success" };
}

/** Apagar = dispensar (fica marcada para a tarefa diária não a recriar). Uma (id) ou todas as já lidas. */
export async function dismissNotificationsAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const id = formString(formData, "id");
  let q = session.supabase.from("notifications").update({ dismissed_at: new Date().toISOString() }).is("dismissed_at", null);
  q = id ? q.eq("id", id) : q.not("read_at", "is", null);
  const { error } = await q;
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/", "layout");
  return { status: "success" };
}

export async function saveNotificationSettingsAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const enabled = new Set(formData.getAll("enabled").filter((v): v is string => typeof v === "string"));
  const disabled: NotificationKind[] = NOTIFICATION_KINDS.filter((k) => !enabled.has(k));
  const days = Number(formString(formData, "dueSoonDays"));
  if (!Number.isInteger(days) || days < 1 || days > 30) return { status: "error", fieldErrors: { dueSoonDays: m.errors.number_invalid } };
  const expiryDays = Number(formString(formData, "expirySoonDays") || "7");
  if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 60) {
    return { status: "error", fieldErrors: { expirySoonDays: m.errors.number_invalid } };
  }
  const fields = { disabled_kinds: disabled, due_soon_days: days, expiry_soon_days: expiryDays };
  const updated = await session.supabase.from("notification_settings").update(fields).eq("user_id", session.user.id).select("user_id");
  if (updated.error) return { status: "error", message: errorMessage(m, updated.error) };
  if (!updated.data?.length) {
    const { error } = await session.supabase.from("notification_settings").insert({ user_id: session.user.id, ...fields });
    if (error) return { status: "error", message: errorMessage(m, error) };
  }
  revalidatePath("/notificacoes");
  return { status: "success", message: m.notifications.settings.saved };
}
