"use client";

import { useEffect, useState } from "react";
import type { Messages } from "@anen/i18n";
import { Button, cx } from "@/components/ui";

/** Evento do Chrome/Edge/Samsung Internet para mostrar o pedido de instalação quando a pessoa quiser. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const READY = "anen:install-ready";
let deferred: BeforeInstallPromptEvent | null = null;

/** Regista o service worker e guarda o pedido de instalação (em toda a app, incluindo as páginas públicas). */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event(READY));
    };
    const onInstalled = () => {
      deferred = null;
      window.dispatchEvent(new Event(READY));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

type Mode = "installed" | "prompt" | "ios" | "other" | "unknown";

function detect(): Mode {
  if (typeof window === "undefined") return "unknown";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (deferred) return "prompt";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

/** Cartão "Instalar a app": botão (Android/Chrome), passos para o iPhone, ou "já instalada". */
export function InstallApp({ m, compact = false }: { m: Messages; compact?: boolean }) {
  const t = m.pwa;
  const [mode, setMode] = useState<Mode>("unknown");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem("anen-install-dismissed") === "1");
    } catch {
      /* armazenamento indisponível: mostra */
    }
    const update = () => setMode(detect());
    update();
    window.addEventListener(READY, update);
    return () => window.removeEventListener(READY, update);
  }, []);

  if (mode === "unknown" || (compact && (dismissed || mode === "installed" || mode === "other"))) return null;

  const install = async () => {
    if (!deferred) return;
    setBusy(true);
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    deferred = null;
    setBusy(false);
    setMode(detect());
  };

  return (
    <div className={cx("glass spot flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:gap-4", compact && "pop-in")}>
      <img src="/icon-192.png" alt="" width={48} height={48} className="float size-12 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{mode === "installed" ? t.installedTitle : t.title}</p>
        {mode === "installed" ? <p className="text-sm text-muted">{t.installedBody}</p> : null}
        {mode === "prompt" ? <p className="text-sm text-muted">{t.body}</p> : null}
        {mode === "ios" ? (
          <ol className="list-decimal pl-5 text-sm text-muted">
            <li>{t.iosStep1}</li>
            <li>{t.iosStep2}</li>
            <li>{t.iosStep3}</li>
          </ol>
        ) : null}
        {mode === "other" ? <p className="text-sm text-muted">{t.other}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {mode === "prompt" ? (
          <Button type="button" onClick={install} disabled={busy}>
            {t.install}
          </Button>
        ) : null}
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem("anen-install-dismissed", "1");
              } catch {
                /* sem armazenamento: só esconde agora */
              }
            }}
          >
            {t.notNow}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
