"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { startCheckoutAction } from "./actions";
import { startBankTransferAction } from "./bank-actions";

export function BuyButton({
  m,
  plan,
  months,
  label,
  confirmMessage,
  bank = false,
}: {
  m: Messages;
  plan: string;
  months: number;
  label: string;
  confirmMessage?: string;
  /** Portugal: transferência por IBAN em vez do checkout da InfinitePay. */
  bank?: boolean;
}) {
  return (
    <ActionForm action={bank ? startBankTransferAction : startCheckoutAction} {...(confirmMessage ? { confirmMessage } : {})}>
      {() => (
        <>
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="months" value={String(months)} />
          <SubmitButton pendingLabel={m.billing.opening} className="w-full">
            {label}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
