import type { PermissionKey, WorkspaceRef } from "@anen/types";

/**
 * Dual Workspace (Fase 2, opção A): um workspace é o espaço pessoal (registos com owner_user_id)
 * ou uma organização (registos com organization_id). Estas funções são puras: recebem o que a
 * sessão do servidor já carregou e nunca confiam num workspace enviado pelo cliente.
 * A autorização real continua no RLS de cada tabela.
 */

/** O que estas funções precisam da sessão (SessionContext encaixa nesta forma). */
export interface WorkspaceSessionInput {
  user: { id: string };
  preferences: { currency_code: string; timezone: string };
  active: {
    organization: { id: string; name: string; currency_code: string; timezone: string };
    permissions: ReadonlySet<string>;
  } | null;
  memberships?: readonly { organization: { id: string; name: string; currency_code: string; timezone: string } }[];
}

export interface WorkspaceScope {
  workspace: WorkspaceRef;
  orgId: string | null;
  ownerId: string | null;
  column: "organization_id" | "owner_user_id";
  value: string;
  canRead: boolean;
  canWrite: boolean;
  defaultCurrency: string;
  timezone: string;
}

/** Workspace ativo. Só é BUSINESS se a organização ativa veio da lista de membros carregada no servidor. */
export function activeWorkspace(session: WorkspaceSessionInput): WorkspaceRef {
  return session.active ? { type: "BUSINESS", id: session.active.organization.id } : { type: "PERSONAL", id: session.user.id };
}

/**
 * Âmbito de um módulo no workspace ativo. No pessoal, o dono pode tudo; numa organização valem as
 * permissões da função (por exemplo finance.read / finance.write).
 */
export function workspaceScope(session: WorkspaceSessionInput, permissions: { read: PermissionKey; write: PermissionKey }): WorkspaceScope {
  const workspace = activeWorkspace(session);
  if (workspace.type === "BUSINESS" && session.active) {
    const org = session.active.organization;
    return {
      workspace,
      orgId: org.id,
      ownerId: null,
      column: "organization_id",
      value: org.id,
      canRead: session.active.permissions.has(permissions.read),
      canWrite: session.active.permissions.has(permissions.write),
      defaultCurrency: org.currency_code,
      timezone: org.timezone,
    };
  }
  return {
    workspace,
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

/** Chave estável e sem dados sensíveis para separar caches e estado por workspace ("personal" ou "org:<id>"). */
export function workspaceKey(workspace: WorkspaceRef): string {
  return workspace.type === "PERSONAL" ? "personal" : `org:${workspace.id}`;
}

export interface WorkspaceOption {
  workspace: WorkspaceRef;
  /** null no pessoal (a interface traduz "Pessoal"). */
  name: string | null;
  currency: string;
  timezone: string;
  active: boolean;
}

/** Workspaces a que a pessoa tem acesso: o pessoal primeiro e depois as organizações (já filtradas pelo RLS). */
export function listWorkspaces(session: WorkspaceSessionInput): WorkspaceOption[] {
  const current = workspaceKey(activeWorkspace(session));
  const personal: WorkspaceRef = { type: "PERSONAL", id: session.user.id };
  return [
    { workspace: personal, name: null, currency: session.preferences.currency_code, timezone: session.preferences.timezone, active: current === "personal" },
    ...(session.memberships ?? []).map((m) => {
      const workspace: WorkspaceRef = { type: "BUSINESS", id: m.organization.id };
      return {
        workspace,
        name: m.organization.name,
        currency: m.organization.currency_code,
        timezone: m.organization.timezone,
        active: current === workspaceKey(workspace),
      };
    }),
  ];
}

/**
 * Resolve um workspace pedido (por exemplo, o valor de um seletor) contra os que a pessoa tem.
 * Devolve null se não for dela: conhecer o id de uma organização nunca chega.
 */
export function resolveWorkspace(session: WorkspaceSessionInput, requested: string): WorkspaceRef | null {
  if (requested === "personal") return { type: "PERSONAL", id: session.user.id };
  const id = requested.startsWith("org:") ? requested.slice(4) : requested;
  const member = (session.memberships ?? []).find((m) => m.organization.id === id);
  return member ? { type: "BUSINESS", id: member.organization.id } : null;
}

/** Nome do campo oculto que os formulários enviam com o workspace que estava no ecrã. */
export const WORKSPACE_FIELD = "__workspace";

/**
 * Compara o workspace que o formulário trazia com o workspace ativo no servidor.
 * "missing": o pedido não diz de que workspace vem (recusado: falha fechada).
 * "changed": outra aba ou janela mudou o workspace ativo depois de a página ser aberta.
 */
export function checkWorkspaceKey(session: WorkspaceSessionInput, sent: string | null | undefined): "ok" | "missing" | "changed" {
  if (!sent) return "missing";
  return sent === workspaceKey(activeWorkspace(session)) ? "ok" : "changed";
}
