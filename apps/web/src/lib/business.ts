import "server-only";
import type { Contact, CostCenter, Project } from "@anen/types";
import { can, type SessionContext } from "@/lib/session";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * Âmbito de negócio (clientes, fornecedores, projetos, centros de custo): o mesmo princípio do
 * âmbito financeiro, com as permissões business.*. Determinado sempre a partir da sessão.
 */
export interface BusinessScope {
  orgId: string | null;
  ownerId: string | null;
  column: "organization_id" | "owner_user_id";
  value: string;
  canRead: boolean;
  canWrite: boolean;
  defaultCurrency: string;
  timezone: string;
}

export function businessScope(session: SessionContext): BusinessScope {
  if (session.active) {
    const org = session.active.organization;
    return {
      orgId: org.id,
      ownerId: null,
      column: "organization_id",
      value: org.id,
      canRead: can(session.active, "business.read"),
      canWrite: can(session.active, "business.write"),
      defaultCurrency: org.currency_code,
      timezone: org.timezone,
    };
  }
  return {
    orgId: null,
    ownerId: session.user.id,
    column: "owner_user_id",
    value: session.user.id,
    canRead: true,
    canWrite: true,
    defaultCurrency: session.preferences.currency_code,
    timezone: session.preferences.timezone,
  };
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
