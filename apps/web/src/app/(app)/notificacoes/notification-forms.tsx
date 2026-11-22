"use client";

import type { Messages } from "@anen/i18n";
import { NOTIFICATION_KINDS, type NotificationKind } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { dismissNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, saveNotificationSettingsAction } from "./actions";

export function MarkAllReadButton({ m }: { m: Messages }) {
  return (
    <ActionForm action={markAllNotificationsReadAction}>
      {() => (
        <SubmitButton pendingLabel={m.common.saving} variant="secondary">
          {m.notifications.markAllRead}
        </SubmitButton>
      )}
    </ActionForm>
  );
}

export function MarkReadButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={markNotificationReadAction} fields={{ id }} label={m.notifications.markRead} pendingLabel={m.common.saving} />;
}

export function DismissNotificationButton({ m, id }: { m: Messages; id: string }) {
  return <InlineAction action={dismissNotificationsAction} fields={{ id }} label={m.notifications.dismiss} pendingLabel={m.common.saving} />;
}

export function DismissReadButton({ m }: { m: Messages }) {
  return (
    <InlineAction
      action={dismissNotificationsAction}
      fields={{}}
      label={m.notifications.dismissRead}
      pendingLabel={m.common.saving}
      confirmMessage={m.notifications.confirmDismissRead}
      variant="secondary"
    />
  );
}

export function NotificationSettingsForm({
  m,
  disabled,
  dueSoonDays,
  expirySoonDays,
}: {
  m: Messages;
  disabled: NotificationKind[];
  dueSoonDays: number;
  expirySoonDays: number;
}) {
  const t = m.notifications;
  return (
    <ActionForm action={saveNotificationSettingsAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="sr-only">{t.settings.title}</legend>
            {NOTIFICATION_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="enabled" value={k} defaultChecked={!disabled.includes(k)} className="size-4 accent-[#FF851B]" />
                {t.kinds[k]}
              </label>
            ))}
          </fieldset>
          <Field
            name="dueSoonDays"
            type="number"
            min={1}
            max={30}
            label={t.settings.dueSoonDays}
            defaultValue={String(dueSoonDays)}
            className="max-w-28"
            error={state.fieldErrors?.dueSoonDays}
          />
          <Field
            name="expirySoonDays"
            type="number"
            min={1}
            max={60}
            label={t.settings.expirySoonDays}
            defaultValue={String(expirySoonDays)}
            className="max-w-28"
            error={state.fieldErrors?.expirySoonDays}
          />
          <SubmitButton pendingLabel={m.common.saving} variant="secondary" className="self-start">
            {t.settings.save}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
