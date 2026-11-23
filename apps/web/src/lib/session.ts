import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Organization, Role, UserPreferences, UserProfile, PermissionKey } from "@anen/types";
import { createClient, type ServerClient } from "@/lib/supabase/server";

export interface Membership {
  memberId: string;
  organization: Organization;
  role: Role;
  permissions: ReadonlySet<string>;
}

export interface SessionContext {
  supabase: ServerClient;
  user: { id: string; email: string };
  profile: UserProfile;
  preferences: UserPreferences;
  memberships: Membership[];
  active: Membership | null;
}

/** Carrega utilizador, perfil, preferências e organizações (uma vez por pedido). Tudo passa por RLS. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : "";

  const loadIdentity = () =>
    Promise.all([
      supabase.from("users_profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
    ]);
  let [[profileRes, prefsRes], membersRes] = await Promise.all([
    loadIdentity(),
    supabase.from("organization_members").select("*").eq("user_id", userId).eq("status", "active"),
  ]);
  if (profileRes.error || prefsRes.error || membersRes.error) {
    throw new Error("Falha ao carregar a sessão");
  }
  if (!profileRes.data || !prefsRes.data) {
    // Conta sem espaço pessoal (por exemplo, anterior ao gatilho de registo): repõe-no de forma idempotente.
    const ensured = await supabase.rpc("ensure_personal_workspace");
    if (ensured.error) throw new Error("Falha ao preparar o espaço pessoal");
    [profileRes, prefsRes] = await loadIdentity();
    if (profileRes.error || prefsRes.error) throw new Error("Falha ao carregar a sessão");
  }
  if (!profileRes.data || !prefsRes.data) return null;

  const members = membersRes.data ?? [];
  const orgIds = members.map((m) => m.organization_id);
  const roleIds = [...new Set(members.map((m) => m.role_id))];

  const [orgsRes, rolesRes, permsRes] = await Promise.all([
    orgIds.length ? supabase.from("organizations").select("*").in("id", orgIds) : Promise.resolve({ data: [], error: null }),
    roleIds.length ? supabase.from("roles").select("*").in("id", roleIds) : Promise.resolve({ data: [], error: null }),
    roleIds.length
      ? supabase.from("role_permissions").select("*").in("role_id", roleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (orgsRes.error || rolesRes.error || permsRes.error) throw new Error("Falha ao carregar organizações");

  const orgs = new Map((orgsRes.data ?? []).map((o) => [o.id, o]));
  const roles = new Map((rolesRes.data ?? []).map((r) => [r.id, r]));
  const perms = new Map<string, Set<string>>();
  for (const rp of permsRes.data ?? []) {
    const set = perms.get(rp.role_id) ?? new Set<string>();
    set.add(rp.permission_key);
    perms.set(rp.role_id, set);
  }

  const memberships: Membership[] = members.flatMap((m) => {
    const organization = orgs.get(m.organization_id);
    const role = roles.get(m.role_id);
    if (!organization || !role) return [];
    return [{ memberId: m.id, organization, role, permissions: perms.get(m.role_id) ?? new Set<string>() }];
  });
  memberships.sort((a, b) => a.organization.name.localeCompare(b.organization.name));

  const active = memberships.find((m) => m.organization.id === prefsRes.data?.active_organization_id) ?? null;

  return {
    supabase,
    user: { id: userId, email },
    profile: profileRes.data,
    preferences: prefsRes.data,
    memberships,
    active,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/entrar");
  return session;
}

export async function requireOnboardedSession(): Promise<SessionContext> {
  const session = await requireSession();
  if (!session.profile.onboarded_at) redirect("/boas-vindas");
  return session;
}

export async function requireActiveOrganization(): Promise<SessionContext & { active: Membership }> {
  const session = await requireOnboardedSession();
  if (!session.active) redirect("/painel");
  return session as SessionContext & { active: Membership };
}

export function can(membership: Membership | null, permission: PermissionKey): boolean {
  return membership?.permissions.has(permission) ?? false;
}
