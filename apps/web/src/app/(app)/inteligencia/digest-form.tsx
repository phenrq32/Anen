"use client";

import type { Messages } from "@anen/i18n";
import type { AiDigestKind } from "@anen/types";
import { ActionForm, SubmitButton } from "@/components/forms";
import { generateDigestAction } from "./actions";

export function DigestForm({ m, kind, hasDigest, disabled }: { m: Messages; kind: AiDigestKind; hasDigest: boolean; disabled: boolean }) {
  const t = m.intelligence.digest;
  return (
    <ActionForm action={generateDigestAction} className="gap-3">
      {() => (
        <div className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="kind" value={kind} />
          {disabled ? null : (
            <SubmitButton variant={hasDigest ? "secondary" : "primary"} pendingLabel={t.generating}>
              {hasDigest ? t.regenerate : t.generate}
            </SubmitButton>
          )}
          <span className="text-xs text-subtle">{t.cost}</span>
        </div>
      )}
    </ActionForm>
  );
}
