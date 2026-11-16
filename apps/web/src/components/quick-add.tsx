"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { Messages } from "@anen/i18n";
import { Alert, Button } from "@/components/ui";
import { initialFormState } from "@/lib/form";
import { saveTransactionAction } from "@/app/(app)/financas/actions";
import { TransactionFields, type AccountOption, type CategoryOption } from "@/app/(app)/financas/finance-forms";

/** Registo rápido de movimentos, disponível em toda a área autenticada (botão ou tecla N). */
export function QuickAdd({
  m,
  accounts,
  categories,
  today,
}: {
  m: Messages;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [round, setRound] = useState(0);
  const [lastDescription, setLastDescription] = useState("");
  const [state, action, pending] = useActionState(async (prev: typeof initialFormState, data: FormData) => {
    const result = await saveTransactionAction(prev, data);
    if (result.status === "success") setLastDescription(String(data.get("description") ?? ""));
    return result;
  }, initialFormState);
  const lastHandled = useRef(state);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        dialog.current?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Após sucesso, limpa o formulário para o próximo registo (mantém o diálogo aberto).
  useEffect(() => {
    if (state !== lastHandled.current && state.status === "success") setRound((r) => r + 1);
    lastHandled.current = state;
  }, [state]);

  if (accounts.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="fixed bottom-5 right-5 z-30 flex h-14 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-ink shadow-[0_8px_30px_rgba(255,133,27,0.25)] transition-transform hover:scale-[1.03] hover:bg-brand-hover active:scale-95 lg:bottom-8 lg:right-8"
        title={m.finance.tx.shortcutHint}
      >
        <span className="text-xl leading-none" aria-hidden>+</span>
        <span>{m.finance.tx.quickAdd}</span>
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-paper backdrop:bg-black/70 backdrop:backdrop-blur-sm open:animate-[dialog-in_180ms_ease-out]"
        aria-labelledby="quick-add-title"
      >
        <form
          key={round}
          className="flex flex-col gap-5 p-5 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => action(data));
          }}
        >
          <div className="flex items-center justify-between">
            <h2 id="quick-add-title" className="text-lg font-semibold">{m.finance.tx.quickAdd}</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="grid size-9 place-items-center rounded-md text-muted hover:bg-graphite hover:text-paper" aria-label={m.common.close}>
              ✕
            </button>
          </div>
          {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
          {state.status === "success" && round > 0 && !pending ? (
            <Alert tone="success">
              {state.message} <span className="font-medium">«{lastDescription}»</span>
            </Alert>
          ) : null}
          <TransactionFields m={m} accounts={accounts} categories={categories} defaults={{ date: today }} errors={state.fieldErrors} compact />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-subtle">{m.finance.tx.shortcutHint}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                {m.common.close}
              </Button>
              <PendingSubmit pending={pending} label={m.common.save} pendingLabel={m.common.saving} />
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}

function PendingSubmit({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
