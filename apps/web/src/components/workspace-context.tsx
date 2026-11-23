"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { WORKSPACE_FIELD } from "@/lib/workspace";

const WorkspaceKeyContext = createContext<string | null>(null);

/**
 * Guarda a chave do workspace com que a página foi desenhada ("personal" ou "org:<id>").
 * Os formulários enviam-na e o servidor recusa gravar se, entretanto, outra aba mudou o workspace ativo.
 */
export function WorkspaceKeyProvider({ value, children }: { value: string; children: ReactNode }) {
  return <WorkspaceKeyContext.Provider value={value}>{children}</WorkspaceKeyContext.Provider>;
}

export function useWorkspaceKey(): string | null {
  return useContext(WorkspaceKeyContext);
}

/** Campo oculto para formulários que chamam ações do servidor. Fora da área autenticada não desenha nada. */
export function WorkspaceField() {
  const key = useWorkspaceKey();
  return key ? <input type="hidden" name={WORKSPACE_FIELD} value={key} /> : null;
}

const CHANNEL = "anen-workspace";

/**
 * Mantém a aba no workspace ativo. Quando outra aba muda de contexto (BroadcastChannel) ou quando a aba
 * volta a ficar visível e o servidor diz que o workspace mudou (outra janela ou outro aparelho), a página é
 * redesenhada no workspace certo, em vez de continuar a mostrar o menu e os dados do anterior.
 * As gravações já estão protegidas no servidor (guardWorkspace); isto evita que a pessoa veja o contexto errado.
 */
export function WorkspaceSync() {
  const key = useWorkspaceKey();
  const router = useRouter();
  useEffect(() => {
    if (!key) return;
    let channel: BroadcastChannel | null = null;
    try {
      channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    } catch {
      channel = null;
    }
    // Esta aba acabou de ser desenhada neste workspace: avisa as outras.
    channel?.postMessage({ key });
    const onMessage = (e: MessageEvent<{ key?: unknown }>) => {
      if (typeof e.data?.key === "string" && e.data.key !== key) router.refresh();
    };
    channel?.addEventListener("message", onMessage);

    let checking = false;
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      try {
        const res = await fetch("/api/workspace", { cache: "no-store", credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { key?: unknown };
          if (typeof body.key === "string" && body.key !== key) router.refresh();
        }
      } catch {
        // Sem rede: a guarda do servidor continua a impedir gravações no workspace errado.
      } finally {
        checking = false;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [key, router]);
  return null;
}
