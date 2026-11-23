import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMessages, isLocale } from "@anen/i18n";
import type { AppNotification } from "@anen/types";
import { getPublicEnv } from "@/lib/env";
import { notificationText, safeNotificationLink } from "@/lib/notifications";
import { pushConfigured, sendPush } from "@/lib/push";

/**
 * Rotina diária (Vercel Cron): envia por push as notificações novas a quem ativou as notificações no aparelho.
 * Protegida pelo CRON_SECRET (a Vercel envia-o no cabeçalho). Na base de dados usa só PUSH_DISPATCH_SECRET,
 * que dá acesso apenas às funções push_claim_batch e push_report.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cron = process.env.CRON_SECRET;
  if (!cron || request.headers.get("authorization") !== `Bearer ${cron}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const env = getPublicEnv();
  const secret = process.env.PUSH_DISPATCH_SECRET;
  if (!env || !secret || !pushConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const db = createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: rows, error }, { data: currencies }] = await Promise.all([
    db.rpc("push_claim_batch", { p_secret: secret, p_limit: 300 }),
    db.from("currencies").select("code, minor_unit"),
  ]);
  if (error) return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  const minorUnits = new Map<string, number>((currencies ?? []).map((c: { code: string; minor_unit: number }) => [c.code, c.minor_unit]));

  let sent = 0;
  let failed = 0;
  for (const r of (rows ?? []) as Array<{
    notification_id: string;
    subscription_id: string;
    kind: AppNotification["kind"];
    data: Record<string, unknown>;
    link: string | null;
    organization_id: string | null;
    language_code: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>) {
    const locale = isLocale(r.language_code) ? r.language_code : "pt-PT";
    const m = getMessages(locale);
    const text = notificationText(
      m,
      locale,
      { id: r.notification_id, user_id: "", organization_id: r.organization_id, kind: r.kind, entity_id: null, data: r.data ?? {}, link: r.link, dedupe_key: "", created_at: "", read_at: null, dismissed_at: null },
      minorUnits,
    );
    const result = await sendPush(r, { title: text.title, body: text.body, link: safeNotificationLink(r.link), tag: r.notification_id });
    if (result === "ok") sent++;
    else failed++;
    await db.rpc("push_report", { p_secret: secret, p_subscription_id: r.subscription_id, p_ok: result === "ok", p_gone: result === "gone" });
  }
  return NextResponse.json({ sent, failed });
}
