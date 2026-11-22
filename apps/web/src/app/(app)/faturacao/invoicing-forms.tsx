"use client";

import type { Messages } from "@anen/i18n";
import type { FiscalAddress } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import {
  cancelFiscalDocumentAction,
  connectInvoicingAction,
  creditNoteAction,
  deleteDraftAction,
  disconnectInvoicingAction,
  emailFiscalDocumentAction,
  finalizeFiscalDocumentAction,
  refreshFiscalDocumentAction,
  refreshInvoicingSettingsAction,
  saveLoadAddressAction,
} from "./actions";

export function ConnectForm({ m, accountName, reconnect }: { m: Messages; accountName?: string; reconnect?: boolean }) {
  const t = m.invoicing.connect;
  return (
    <ActionForm action={connectInvoicingAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="accountName" label={t.accountName} hint={t.accountHint} defaultValue={accountName ?? ""} required autoComplete="off" maxLength={63} error={state.fieldErrors?.accountName} />
            <Field name="apiKey" type="password" label={t.apiKey} hint={t.apiKeyHint} required autoComplete="off" maxLength={200} error={state.fieldErrors?.apiKey} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} variant={reconnect ? "secondary" : "primary"} className="self-start">
            {reconnect ? t.reconnect : t.submit}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function LoadAddressForm({ m, address }: { m: Messages; address: FiscalAddress | null }) {
  const t = m.invoicing.loadAddress;
  return (
    <ActionForm action={saveLoadAddressAction}>
      {() => (
        <div className="flex flex-col gap-4">
          <Field name="detail" label={t.detail} defaultValue={address?.detail ?? ""} required maxLength={200} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="postalCode" label={t.postalCode} defaultValue={address?.postal_code ?? ""} required maxLength={20} />
            <Field name="city" label={t.city} defaultValue={address?.city ?? ""} required maxLength={120} />
            <Field name="country" label={t.country} defaultValue={address?.country ?? "Portugal"} maxLength={60} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} variant="secondary" className="self-start">{t.save}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function RefreshSettingsButton({ m }: { m: Messages }) {
  return (
    <ActionForm action={refreshInvoicingSettingsAction}>
      {() => <SubmitButton pendingLabel={m.common.saving} variant="secondary">{m.invoicing.refreshSettings}</SubmitButton>}
    </ActionForm>
  );
}

export function DisconnectButton({ m }: { m: Messages }) {
  return <InlineAction action={disconnectInvoicingAction} fields={{}} label={m.invoicing.disconnect} pendingLabel={m.common.saving} confirmMessage={m.invoicing.confirmDisconnect} variant="danger" />;
}

export function FinalizeForm({ m, id, accounts, withFinance }: { m: Messages; id: string; accounts: { id: string; name: string }[]; withFinance: boolean }) {
  const t = m.invoicing.detail;
  return (
    <ActionForm action={finalizeFiscalDocumentAction}>
      {() => (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          {withFinance && accounts.length > 0 ? (
            <SelectField
              name="accountId"
              label={t.financeAccount}
              defaultValue={accounts[0]!.id}
              options={[...accounts.map((a) => ({ value: a.id, label: a.name })), { value: "", label: t.noFinance }]}
            />
          ) : null}
          <ConfirmSubmit label={t.finalize} confirm={t.confirmFinalize} pending={m.common.saving} />
        </div>
      )}
    </ActionForm>
  );
}

/** Botão de envio com confirmação do browser (ações definitivas). */
function ConfirmSubmit({ label, confirm, pending, variant = "primary" }: { label: string; confirm: string; pending: string; variant?: "primary" | "danger" }) {
  return (
    <span
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("button") && !window.confirm(confirm)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="self-start"
    >
      <SubmitButton pendingLabel={pending} variant={variant}>{label}</SubmitButton>
    </span>
  );
}

export function CancelForm({ m, id }: { m: Messages; id: string }) {
  const t = m.invoicing.detail;
  return (
    <ActionForm action={cancelFiscalDocumentAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <Field name="reason" label={t.cancelReason} required maxLength={500} error={state.fieldErrors?.reason} />
          <ConfirmSubmit label={t.cancel} confirm={t.confirmCancel} pending={m.common.saving} variant="danger" />
        </div>
      )}
    </ActionForm>
  );
}

export function EmailForm({ m, id, email }: { m: Messages; id: string; email: string | null }) {
  const t = m.invoicing.detail;
  return (
    <ActionForm action={emailFiscalDocumentAction}>
      {(state) => (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={id} />
          <Field name="email" type="email" label={t.email} defaultValue={email ?? ""} required className="sm:min-w-72" error={state.fieldErrors?.email} />
          <SubmitButton pendingLabel={m.common.saving} variant="secondary">{t.send}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function DocActionButton({ m, id, kind }: { m: Messages; id: string; kind: "refresh" | "credit" | "delete" }) {
  const t = m.invoicing.detail;
  if (kind === "delete") {
    return <InlineAction action={deleteDraftAction} fields={{ id }} label={t.deleteDraft} pendingLabel={m.common.saving} confirmMessage={t.confirmDelete} variant="danger" />;
  }
  if (kind === "credit") {
    return <InlineAction action={creditNoteAction} fields={{ id }} label={t.creditNote} pendingLabel={m.common.saving} variant="secondary" />;
  }
  return <InlineAction action={refreshFiscalDocumentAction} fields={{ id }} label={t.refresh} pendingLabel={m.common.saving} variant="secondary" />;
}
