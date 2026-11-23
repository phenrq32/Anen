"use server";

import { z } from "zod";
import { getI18n } from "@/lib/i18n";
import { pushConfigured, sendPush } from "@/lib/push";
import { requireSession } from "@/lib/session";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Guarda a inscrição deste aparelho (substitui a anterior com o mesmo endereço). */
export async function savePushSubscriptionAction(raw: unknown, userAgent: string): Promise<{ ok: boolean; message?: string }> {
  const session = await requireSession();
  const { m } = await getI18n();
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: m.push.failed };
  const s = parsed.data;
  await session.supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
  const { error } = await session.supabase.from("push_subscriptions").insert({
    user_id: session.user.id,
    endpoint: s.endpoint,
    p256dh: s.keys.p256dh,
    auth: s.keys.auth,
    user_agent: userAgent.slice(0, 300) || null,
  });
  return error ? { ok: false, message: m.push.failed } : { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const { error } = await session.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint.slice(0, 1000));
  return { ok: !error };
}

/** Envia uma notificação de teste para os aparelhos da própria pessoa. */
export async function sendTestPushAction(): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const { m } = await getI18n();
  if (!pushConfigured()) return { ok: false, message: m.push.notConfigured };
  const { data } = await session.supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (!data?.length) return { ok: false, message: m.push.noDevices };
  let ok = 0;
  for (const s of data) {
    const r = await sendPush(s, { title: m.push.testTitle, body: m.push.testBody, link: "/notificacoes", tag: "anen-test" });
    if (r === "ok") ok++;
    if (r === "gone") await session.supabase.from("push_subscriptions").delete().eq("id", s.id);
  }
  return ok > 0 ? { ok: true, message: m.push.testSent } : { ok: false, message: m.push.failed };
}
