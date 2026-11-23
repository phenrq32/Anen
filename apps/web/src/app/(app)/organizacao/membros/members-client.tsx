"use client";

import { useActionState } from "react";
import type { Messages } from "@anen/i18n";
import { ActionForm, CopyField, InlineAction, SubmitButton } from "@/components/forms";
import { Alert, Field, SelectField } from "@/components/ui";
import { initialFormState } from "@/lib/form";
import { inviteMemberAction, removeMemberAction, updateMemberAction } from "../../actions";
import { WorkspaceField } from "@/components/workspace-context";

export interface RoleOption {
  value: string;
  label: string;
}

export function InviteForm({ m, roles }: { m: Messages; roles: RoleOption[] }) {
  return (
    <ActionForm action={inviteMemberAction}>
      {(state) => (
        <>
          {state.status === "success" && state.data?.link ? (
            <div className="flex flex-col gap-2">
              <CopyField value={state.data.link} copyLabel={m.common.copy} copiedLabel={m.common.copied} />
              <p className="text-[13px] text-subtle">{m.members.emailDeliveryPending}</p>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
            <Field name="email" type="email" label={m.members.inviteEmail} autoComplete="off" required error={state.fieldErrors?.email} />
            <SelectField name="roleId" label={m.members.inviteRole} options={roles} defaultValue={roles.at(-1)?.value} error={state.fieldErrors?.roleId} />
            <SubmitButton pendingLabel={m.common.saving}>{m.members.inviteSubmit}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function MemberRoleForm({
  m,
  memberId,
  roleId,
  status,
  roles,
}: {
  m: Messages;
  memberId: string;
  roleId: string;
  status: "active" | "suspended";
  roles: RoleOption[];
}) {
  const [state, action] = useActionState(updateMemberAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-1">
<WorkspaceField />
      <input type="hidden" name="memberId" value={memberId} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${memberId}`}>
          {m.members.changeRole}
        </label>
        <select
          id={`role-${memberId}`}
          name="roleId"
          defaultValue={roleId}
          className="h-9 rounded-md border border-line bg-graphite px-2.5 text-sm text-paper focus:border-brand focus:outline-none"
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`status-${memberId}`}>
          {m.members.status}
        </label>
        <select
          id={`status-${memberId}`}
          name="status"
          defaultValue={status}
          className="h-9 rounded-md border border-line bg-graphite px-2.5 text-sm text-paper focus:border-brand focus:outline-none"
        >
          <option value="active">{m.members.statuses.active}</option>
          <option value="suspended">{m.members.statuses.suspended}</option>
        </select>
        <SubmitButton variant="secondary" pendingLabel={m.common.saving} className="h-9 px-3">
          {m.common.save}
        </SubmitButton>
      </div>
      {state.status === "error" && state.message ? <p role="alert" className="text-xs text-danger">{state.message}</p> : null}
      {state.status === "success" ? <p role="status" className="text-xs text-success">{m.settings.saved}</p> : null}
    </form>
  );
}

export function RemoveMemberButton({ m, memberId, self }: { m: Messages; memberId: string; self: boolean }) {
  return (
    <InlineAction
      action={removeMemberAction}
      fields={{ memberId }}
      label={self ? m.members.leave : m.members.remove}
      pendingLabel={m.common.saving}
      confirmMessage={self ? m.members.leave : m.members.remove}
      variant="danger"
    />
  );
}

export function SuccessNote({ text }: { text: string }) {
  return <Alert tone="success">{text}</Alert>;
}
