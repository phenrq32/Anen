"use client";

import { useEffect, useState, useTransition } from "react";
import type { Messages } from "@anen/i18n";
import { Alert, Button } from "@/components/ui";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/app/(app)/notificacoes/push-actions";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ligar/desligar as notificações push neste aparelho, com envio de teste. */
export function PushToggle({ m, publicKey }: { m: Messages; publicKey: string | null }) {
  const t = m.push;
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !publicKey) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      setMessage(null);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey!) });
      const res = await savePushSubscriptionAction(sub.toJSON(), navigator.userAgent);
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        return setMessage({ tone: "error", text: res.message ?? t.failed });
      }
      setState("on");
      setMessage({ tone: "success", text: t.enabled });
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
      }
      setState("off");
      setMessage({ tone: "success", text: t.disabled });
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPushAction();
      setMessage({ tone: res.ok ? "success" : "error", text: res.message });
    });

  if (state === "loading") return null;
  const body =
    state === "on" ? t.onBody : state === "off" ? t.offBody : state === "denied" ? t.denied : state === "ios-install" ? t.iosInstall : t.unsupported;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{body}</p>
      <div className="flex flex-wrap gap-2">
        {state === "off" ? (
          <Button type="button" onClick={enable} disabled={pending}>
            {t.enable}
          </Button>
        ) : null}
        {state === "on" ? (
          <>
            <Button type="button" variant="secondary" onClick={test} disabled={pending}>
              {t.test}
            </Button>
            <Button type="button" variant="ghost" onClick={disable} disabled={pending}>
              {t.disable}
            </Button>
          </>
        ) : null}
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}
