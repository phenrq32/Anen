import "server-only";
import webpush from "web-push";

/**
 * Envio de notificações push (Web Push com VAPID). As chaves ficam só nas variáveis do servidor:
 * VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY e VAPID_SUBJECT (contacto: endereço do site ou mailto:).
 */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  title: string;
  body: string;
  link: string;
  tag?: string;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://anen-five.vercel.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/** "ok" | "gone" (o aparelho já não aceita: apagar a inscrição) | "error". */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<"ok" | "gone" | "error"> {
  configure();
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24, urgency: "normal" },
    );
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "error";
  }
}
