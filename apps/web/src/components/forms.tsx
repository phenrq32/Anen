"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, cx } from "@/components/ui";
import { initialFormState, type FormState } from "@/lib/form";

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * Formulário ligado a uma Server Action, com estados de erro/sucesso acessíveis.
 * O conteúdo recebe o estado atual para mostrar erros por campo.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
}: {
  action: FormAction;
  children: (state: FormState) => ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className={cx("flex flex-col gap-5", className)} noValidate>
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === "success" && (state.message ?? successMessage) ? (
        <Alert tone="success">{state.message ?? successMessage}</Alert>
      ) : null}
      {children(state)}
    </form>
  );
}

/** Botão isolado para ações de uma linha (revogar, remover…), com confirmação e erro inline. */
export function InlineAction({
  action,
  fields,
  label,
  pendingLabel,
  confirmMessage,
  variant = "ghost",
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  confirmMessage?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} pendingLabel={pendingLabel} className="h-9 px-3">
        {label}
      </SubmitButton>
      {state.status === "error" && state.message ? (
        <p role="alert" className="max-w-56 text-right text-xs text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function CopyField({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 w-full min-w-0 rounded-md border border-line bg-ink px-3 font-mono text-[13px] text-muted"
        aria-label={copyLabel}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}

/** Seletor que submete o formulário ao mudar (com botão de recurso sem JavaScript). */
export function AutoSubmitSelect({
  name,
  label,
  defaultValue,
  options,
  submitLabel,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`ctx-${name}`} className="sr-only">
        {label}
      </label>
      <select
        id={`ctx-${name}`}
        name={name}
        defaultValue={defaultValue}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-10 w-full min-w-0 appearance-none truncate rounded-md border border-line bg-graphite px-3 pr-8 text-sm text-paper hover:border-graphite-soft focus:border-brand focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="h-10 rounded-md border border-line px-3 text-sm">
          {submitLabel}
        </button>
      </noscript>
    </div>
  );
}
