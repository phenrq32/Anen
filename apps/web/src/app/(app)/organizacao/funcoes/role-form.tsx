"use client";

import type { Messages } from "@anen/i18n";
import type { PermissionKey } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { deleteRoleAction, saveRoleAction } from "../../actions";

export function RoleForm({
  m,
  grantable,
  role,
}: {
  m: Messages;
  /** Permissões que o utilizador atual possui e pode portanto conceder. */
  grantable: PermissionKey[];
  role?: { id: string; name: string; description: string | null; permissions: string[] };
}) {
  return (
    <ActionForm action={saveRoleAction}>
      {(state) => (
        <>
          {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={m.roles.name} defaultValue={role?.name ?? ""} required error={state.fieldErrors?.name} />
            <Field
              name="description"
              label={m.roles.description}
              optionalLabel={m.common.optional}
              defaultValue={role?.description ?? ""}
              error={state.fieldErrors?.description}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{m.roles.permissions}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {grantable.map((key) => (
                <label key={key} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm hover:border-graphite-soft has-[:checked]:border-brand/60">
                  <input type="checkbox" name="permissions" value={key} defaultChecked={role?.permissions.includes(key)} className="size-4 accent-[#FF851B]" />
                  {m.roles.permissionLabels[key]}
                </label>
              ))}
            </div>
            {state.fieldErrors?.permissions ? <p className="text-[13px] text-danger">{state.fieldErrors.permissions}</p> : null}
          </fieldset>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.roles.submit}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteRoleButton({ m, roleId }: { m: Messages; roleId: string }) {
  return (
    <InlineAction
      action={deleteRoleAction}
      fields={{ roleId }}
      label={m.roles.delete}
      pendingLabel={m.common.saving}
      confirmMessage={m.roles.delete}
      variant="danger"
    />
  );
}
