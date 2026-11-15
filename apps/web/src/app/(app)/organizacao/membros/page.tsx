import type { Metadata } from "next";
import { format, formatDate, type Messages } from "@anen/i18n";
import type { OrganizationInvitation, Role } from "@anen/types";
import { InlineAction } from "@/components/forms";
import { Badge, PageHeader, Section } from "@/components/ui";
import { roleName } from "@/lib/errors";
import { getI18n } from "@/lib/i18n";
import { INVITATION_COLUMNS, profileNames } from "@/lib/org-data";
import { can, requireActiveOrganization } from "@/lib/session";
import { revokeInvitationAction } from "../../actions";
import { InviteForm, MemberRoleForm, RemoveMemberButton, type RoleOption } from "./members-client";

export const metadata: Metadata = { title: "Membros" };

const roleLabel = (m: Messages, role: Role): string => roleName(m, role);

export default async function MembersPage() {
  const { m, locale } = await getI18n();
  const session = await requireActiveOrganization();
  const { active, supabase } = session;
  const orgId = active.organization.id;
  const myRank = active.role.rank;
  const isOwner = active.role.key === "owner" && active.role.is_system;
  const canManage = can(active, "members.manage");
  const canInvite = can(active, "members.invite");

  const [membersRes, rolesRes] = await Promise.all([
    supabase.from("organization_members").select("*").eq("organization_id", orgId).order("created_at"),
    supabase.from("roles").select("*").or(`organization_id.is.null,organization_id.eq.${orgId}`).order("rank", { ascending: false }),
  ]);
  if (membersRes.error || rolesRes.error) throw new Error("Falha ao carregar membros");
  const members = membersRes.data ?? [];
  const roles = rolesRes.data ?? [];
  const roleById = new Map(roles.map((r) => [r.id, r]));

  let invitations: OrganizationInvitation[] = [];
  if (canInvite || canManage) {
    const inv = await supabase
      .from("organization_invitations")
      .select(INVITATION_COLUMNS)
      .eq("organization_id", orgId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (inv.error) throw new Error("Falha ao carregar convites");
    invitations = (inv.data ?? []) as OrganizationInvitation[];
  }

  const names = await profileNames(supabase, members.map((x) => x.user_id));
  // Só se atribuem funções abaixo da própria (proprietários podem atribuir todas) — validado também na base de dados.
  const assignable: RoleOption[] = roles
    .filter((r) => isOwner || r.rank < myRank)
    .map((r) => ({ value: r.id, label: roleLabel(m, r) }));

  return (
    <>
      <PageHeader title={m.members.title} description={m.members.subtitle} />

      {canInvite ? (
        <Section title={m.members.inviteTitle}>
          <InviteForm m={m} roles={assignable} />
        </Section>
      ) : null}

      <Section title={`${m.members.title} · ${members.filter((x) => x.status === "active").length}`}>
        <ul className="-my-3 flex flex-col">
          {members.map((member) => {
            const role = roleById.get(member.role_id);
            const self = member.user_id === session.user.id;
            const canEditThis = canManage && !self && role !== undefined && (isOwner || role.rank < myRank);
            return (
              <li key={member.id} className="flex flex-col gap-3 border-b border-line py-4 last:border-0 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-graphite text-sm font-semibold text-muted" aria-hidden>
                    {(names.get(member.user_id) ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {names.get(member.user_id) ?? "—"}
                      {self ? <span className="ml-2 text-sm font-normal text-subtle">({m.common.you})</span> : null}
                    </p>
                    <p className="text-xs text-subtle">
                      {m.members.since} {formatDate(member.created_at, locale, session.preferences.timezone)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {canEditThis ? (
                    <MemberRoleForm m={m} memberId={member.id} roleId={member.role_id} status={member.status} roles={assignable} />
                  ) : (
                    <div className="flex items-center gap-2">
                      {role ? <Badge tone={role.key === "owner" ? "brand" : "neutral"}>{roleLabel(m, role)}</Badge> : null}
                      {member.status === "suspended" ? <Badge tone="danger">{m.members.statuses.suspended}</Badge> : null}
                    </div>
                  )}
                  {self || canEditThis ? <RemoveMemberButton m={m} memberId={member.id} self={self} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {canInvite || canManage ? (
        <Section title={m.members.pendingTitle}>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted">{m.members.pendingEmpty}</p>
          ) : (
            <ul className="-my-3 flex flex-col">
              {invitations.map((inv) => {
                const role = roleById.get(inv.role_id);
                return (
                  <li key={inv.id} className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-subtle">
                        {role ? roleLabel(m, role) : ""} · {format(m.members.expires, { date: formatDate(inv.expires_at, locale, session.preferences.timezone) })}
                      </p>
                    </div>
                    <InlineAction action={revokeInvitationAction} fields={{ invitationId: inv.id }} label={m.members.revoke} pendingLabel={m.common.saving} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      {!canManage && !canInvite ? <p className="text-sm text-subtle">{m.members.noPermission}</p> : null}
    </>
  );
}
