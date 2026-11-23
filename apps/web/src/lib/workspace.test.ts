import { describe, expect, it } from "vitest";
import { activeWorkspace, listWorkspaces, resolveWorkspace, workspaceKey, workspaceScope, type WorkspaceSessionInput } from "./workspace";

const empresaA = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Empresa A", currency_code: "EUR", timezone: "Europe/Lisbon" };
const empresaB = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Empresa B", currency_code: "BRL", timezone: "America/Sao_Paulo" };
const outra = "cccccccc-0000-4000-8000-000000000003";

const personal: WorkspaceSessionInput = {
  user: { id: "user-1" },
  preferences: { currency_code: "EUR", timezone: "Europe/Lisbon" },
  active: null,
  memberships: [{ organization: empresaA }, { organization: empresaB }],
};
const inB: WorkspaceSessionInput = {
  ...personal,
  active: { organization: empresaB, permissions: new Set(["finance.read", "business.read", "business.write"]) },
};

describe("workspace ativo e âmbito", () => {
  it("sem organização ativa é o pessoal, com tudo permitido e a moeda das preferências", () => {
    expect(activeWorkspace(personal)).toEqual({ type: "PERSONAL", id: "user-1" });
    expect(workspaceScope(personal, { read: "finance.read", write: "finance.write" })).toEqual({
      workspace: { type: "PERSONAL", id: "user-1" },
      orgId: null,
      ownerId: "user-1",
      column: "owner_user_id",
      value: "user-1",
      canRead: true,
      canWrite: true,
      defaultCurrency: "EUR",
      timezone: "Europe/Lisbon",
    });
  });

  it("numa organização filtra por organization_id e aplica as permissões da função", () => {
    const fin = workspaceScope(inB, { read: "finance.read", write: "finance.write" });
    expect(fin).toMatchObject({ workspace: { type: "BUSINESS", id: empresaB.id }, column: "organization_id", value: empresaB.id, ownerId: null });
    expect([fin.canRead, fin.canWrite]).toEqual([true, false]);
    expect(fin.defaultCurrency).toBe("BRL");
    expect(fin.timezone).toBe("America/Sao_Paulo");
    const biz = workspaceScope(inB, { read: "business.read", write: "business.write" });
    expect([biz.canRead, biz.canWrite]).toEqual([true, true]);
    const quotes = workspaceScope(inB, { read: "quotes.read", write: "quotes.write" });
    expect([quotes.canRead, quotes.canWrite]).toEqual([false, false]);
  });

  it("os dois âmbitos nunca se misturam: pessoal e empresa têm colunas e valores diferentes", () => {
    const a = workspaceScope(personal, { read: "finance.read", write: "finance.write" });
    const b = workspaceScope(inB, { read: "finance.read", write: "finance.write" });
    expect(a.column).not.toBe(b.column);
    expect(a.value).not.toBe(b.value);
  });
});

describe("lista, chave e resolução", () => {
  it("lista o pessoal primeiro e marca o ativo", () => {
    expect(listWorkspaces(inB).map((w) => [w.workspace.type, w.name, w.active])).toEqual([
      ["PERSONAL", null, false],
      ["BUSINESS", "Empresa A", false],
      ["BUSINESS", "Empresa B", true],
    ]);
    expect(listWorkspaces(personal)[0]?.active).toBe(true);
  });

  it("chave estável por workspace, sem dados pessoais", () => {
    expect(workspaceKey({ type: "PERSONAL", id: "user-1" })).toBe("personal");
    expect(workspaceKey({ type: "BUSINESS", id: empresaA.id })).toBe(`org:${empresaA.id}`);
  });

  it("só resolve workspaces da própria pessoa; conhecer o id de outra organização não chega", () => {
    expect(resolveWorkspace(personal, "personal")).toEqual({ type: "PERSONAL", id: "user-1" });
    expect(resolveWorkspace(personal, empresaA.id)).toEqual({ type: "BUSINESS", id: empresaA.id });
    expect(resolveWorkspace(personal, `org:${empresaB.id}`)).toEqual({ type: "BUSINESS", id: empresaB.id });
    expect(resolveWorkspace(personal, outra)).toBeNull();
    expect(resolveWorkspace(personal, `org:${outra}`)).toBeNull();
    expect(resolveWorkspace(personal, "")).toBeNull();
    expect(resolveWorkspace({ ...personal, memberships: [] }, empresaA.id)).toBeNull();
  });
});
