import "server-only";
import type { AuditLog } from "@anen/types";
import type { ServerClient } from "@/lib/supabase/server";

/** Nomes de perfis visíveis (o RLS só devolve o próprio e colegas de organização). */
export async function profileNames(supabase: ServerClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from("users_profiles").select("id, full_name").in("id", unique);
  if (error) throw new Error("Falha ao carregar perfis");
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? "—"]));
}

export async function recentAudit(supabase: ServerClient, organizationId: string, limit = 10): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Falha ao carregar auditoria");
  return data ?? [];
}

export const INVITATION_COLUMNS = "id, organization_id, email, role_id, invited_by, expires_at, accepted_at, revoked_at, created_at";
