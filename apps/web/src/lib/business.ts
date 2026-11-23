import "server-only";
import type { Contact, CostCenter, Project } from "@anen/types";
import type { SessionContext } from "@/lib/session";
import { workspaceScope, type WorkspaceScope } from "@/lib/workspace";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * Âmbito de negócio (clientes, fornecedores, projetos, centros de custo) do workspace ativo:
 * o mesmo princípio do âmbito financeiro, com as permissões business.*. Determinado sempre a partir da sessão.
 */
export type BusinessScope = WorkspaceScope;

export function businessScope(session: SessionContext): BusinessScope {
  return workspaceScope(session, { read: "business.read", write: "business.write" });
}

export function businessScopeFields(scope: BusinessScope): { organization_id: string | null; owner_user_id: string | null } {
  return { organization_id: scope.orgId, owner_user_id: scope.ownerId };
}

export interface LinkOptions {
  contacts: Pick<Contact, "id" | "name" | "kind">[];
  projects: Pick<Project, "id" | "name" | "currency_code" | "status">[];
  costCenters: Pick<CostCenter, "id" | "name">[];
}

/** Opções para ligar movimentos. Sem permissão de leitura de negócio, devolve listas vazias. */
export async function loadLinkOptions(supabase: ServerClient, scope: BusinessScope): Promise<LinkOptions> {
  if (!scope.canRead) return { contacts: [], projects: [], costCenters: [] };
  const [contacts, projects, costCenters] = await Promise.all([
    supabase.from("contacts").select("id, name, kind").eq(scope.column, scope.value).is("archived_at", null).order("name").limit(1000),
    supabase.from("projects").select("id, name, currency_code, status").eq(scope.column, scope.value).order("created_at", { ascending: false }).limit(500),
    supabase.from("cost_centers").select("id, name").eq(scope.column, scope.value).is("archived_at", null).order("name"),
  ]);
  if (contacts.error || projects.error || costCenters.error) throw new Error("Falha ao carregar ligações");
  return { contacts: contacts.data ?? [], projects: projects.data ?? [], costCenters: costCenters.data ?? [] };
}
