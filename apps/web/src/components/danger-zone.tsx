"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Ação irreversível: a pessoa escreve o texto pedido (email, nome…) para o botão ficar ativo.
 * Sem texto (`expected` vazio) é só um botão com confirmação.
 */
export function DangerAction({
  action,
  title,
  body,
  button,
  pending,
  expected,
  fieldName,
  fieldLabel,
  confirmMessage,
}: {
  action: Action;
  title: string;
  body: string;
  button: string;
  pending: string;
  expected?: string;
  fieldName?: string;
  fieldLabel?: string;
  confirmMessage?: string;
}) {
  const [typed, setTyped] = useState("");
  const ready = !expected || typed.trim().toLowerCase() === expected.trim().toLowerCase();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-danger">{title}</h3>
        <p className="text-sm text-muted">{body}</p>
      </div>
      <ActionForm action={action} {...(confirmMessage ? { confirmMessage } : {})}>
        {(state) => (
          <div className="flex flex-col gap-3">
            {expected && fieldName ? (
              <Field
                name={fieldName}
                label={fieldLabel ?? ""}
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                error={state.fieldErrors?.[fieldName]}
                className="max-w-sm"
              />
            ) : null}
            <SubmitButton variant="danger" pendingLabel={pending} disabled={!ready} className="self-start">
              {button}
            </SubmitButton>
          </div>
        )}
      </ActionForm>
    </div>
  );
}
