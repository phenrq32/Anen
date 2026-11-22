"use client";

import { useEffect, useRef } from "react";
import type { Messages } from "@anen/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { askAiAction, deleteConversationAction } from "./actions";

/** Caixa de pergunta. Envia com o botão ou com Ctrl/⌘+Enter; limpa depois de responder. */
export function AskForm({ m, conversationId, disabled }: { m: Messages; conversationId: string | null; disabled: boolean }) {
  const t = m.ai;
  return (
    <ActionForm action={askAiAction}>
      {(state) => (
        <AskFields m={m} conversationId={conversationId} disabled={disabled} success={state.status === "success"} error={state.fieldErrors?.question} t={t} />
      )}
    </ActionForm>
  );
}

function AskFields({
  m,
  conversationId,
  disabled,
  success,
  error,
  t,
}: {
  m: Messages;
  conversationId: string | null;
  disabled: boolean;
  success: boolean;
  error: string | undefined;
  t: Messages["ai"];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (success && ref.current) ref.current.value = "";
  }, [success]);
  return (
    <div className="flex flex-col gap-3">
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      <label htmlFor="ai-question" className="sr-only">{t.placeholder}</label>
      <textarea
        ref={ref}
        id="ai-question"
        name="question"
        required
        maxLength={2000}
        rows={3}
        disabled={disabled}
        placeholder={t.placeholder}
        aria-invalid={Boolean(error)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
        }}
        className="w-full resize-y rounded-md border border-line bg-surface px-3.5 py-3 text-[15px] text-paper focus:border-brand focus:outline-none disabled:opacity-50"
      />
      {error ? <span role="alert" className="text-[13px] text-danger">{error}</span> : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">{t.disclaimer}</p>
        <SubmitButton pendingLabel={t.asking} className="shrink-0">
          {t.ask}
        </SubmitButton>
      </div>
    </div>
  );
}

/** Pergunta sugerida: um clique envia (cria conversa nova). */
export function SuggestionButton({ text }: { text: string }) {
  return (
    <ActionForm action={askAiAction} className="contents">
      {() => (
        <>
          <input type="hidden" name="question" value={text} />
          <button
            type="submit"
            className="w-full rounded-lg border border-line px-3.5 py-2.5 text-left text-sm text-muted transition-colors hover:border-brand/40 hover:text-paper"
          >
            {text}
          </button>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteConversationButton({ m, id }: { m: Messages; id: string }) {
  return (
    <InlineAction
      action={deleteConversationAction}
      fields={{ id }}
      label={m.ai.deleteChat}
      pendingLabel={m.common.saving}
      confirmMessage={m.ai.confirmDelete}
    />
  );
}
