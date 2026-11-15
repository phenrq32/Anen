import type { Metadata } from "next";
import type { Messages } from "@anen/i18n";
import { PERMISSION_KEYS, type PermissionKey, type Role } from "@anen/types";
import { Badge, PageHeader, Section } from "@/components/ui";
import { roleName } from "@/lib/errors";
import { getI18n } from "@/lib/i18n";
import { can, requireActiveOrganization } from "@/lib/session";
import { DeleteRoleButton, RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Funções e permissões" };

function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

const roleLabel = (m: Messages, role: Role): string => roleName(m, role);

export default async function RolesPage() {
  const { m } = await getI18n();
  const session = await requireActiveOrganization();
  const { active, supabase } = session;
  const orgId = active.organization.id;

  const rolesRes = await supabase
    .from("roles")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("rank", { ascending: false });
  if (rolesRes.error) throw new Error("Falha ao carregar funções");
  const roles = rolesRes.data ?? [];
  const permsRes = await supabase.from("role_permissions").select("*").in("role_id", roles.map((r) => r.id));
  if (permsRes.error) throw new Error("Falha ao carregar permissões");
  const perms = new Map<string, string[]>();
  for (const p of permsRes.data ?? []) perms.set(p.role_id, [...(perms.get(p.role_id) ?? []), p.permission_key]);

  const canManageRoles = can(active, "roles.manage");
  const grantable = [...active.permissions].filter(isPermissionKey);

  return (
    <>
      <PageHeader title={m.roles.title} description={m.roles.subtitle} />

      <div className="grid gap-4">
        {roles.map((role) => {
          const keys = (perms.get(role.id) ?? []).filter(isPermissionKey);
          const editable = canManageRoles && !role.is_system && role.rank < active.role.rank;
          return (
            <section key={role.id} className="rounded-xl border border-line bg-surface">
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{roleLabel(m, role)}</h2>
                    <Badge tone={role.is_system ? "neutral" : "brand"}>{role.is_system ? m.roles.system : m.roles.custom}</Badge>
                  </div>
                  {role.description && !role.is_system ? <p className="text-sm text-muted">{role.description}</p> : null}
                  <p className="text-sm text-subtle">
                    {keys.length ? keys.map((k) => m.roles.permissionLabels[k]).join(" · ") : m.roles.noPermissions}
                  </p>
                </div>
                {editable ? <DeleteRoleButton m={m} roleId={role.id} /> : null}
              </div>
              {editable ? (
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-5 py-3 text-sm text-muted hover:text-paper sm:px-6">{m.roles.editRole}</summary>
                  <div className="px-5 pb-5 sm:px-6">
                    <RoleForm m={m} grantable={grantable} role={{ id: role.id, name: role.name, description: role.description, permissions: keys }} />
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>

      {canManageRoles ? (
        <Section title={m.roles.newRole}>
          <RoleForm m={m} grantable={grantable} />
        </Section>
      ) : null}

      <p className="text-[13px] text-subtle">{m.roles.futureNote}</p>
    </>
  );
}
