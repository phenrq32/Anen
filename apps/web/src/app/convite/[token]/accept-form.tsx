"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { acceptInvitationAction } from "@/app/(app)/actions";

export function AcceptInvitationForm({ m, token }: { m: Messages; token: string }) {
  return (
    <ActionForm action={acceptInvitationAction}>
      {() => (
        <>
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.invite.accept}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
