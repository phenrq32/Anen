import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

/** Dual Workspace · Fase 4: convites pendentes no seletor (my_invitations, accept_my_invitation). */
let db: PGlite;
let ana: string; // proprietária
let bia: string; // convidada (email confirmado)
let caio: string; // outra pessoa
let naoConfirmada: string; // convidada com email por confirmar
let org: string;
let invitation: string;
let viewerRole: string;

type Row = Record<string, unknown>;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<Row>(sql, params)).rows;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@convites.pt");
  bia = await createUser(db, "bia@convites.pt");
  caio = await createUser(db, "caio@convites.pt");
  naoConfirmada = await createUser(db, "nova@convites.pt", {}, false);
  org = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, `select public.create_organization('business', 'Convites Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  viewerRole = (await db.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
  invitation = await asUser(db, ana, async (t) => (await one<{ invitation_id: string }>(t, `select invitation_id from public.invite_member($1, 'bia@convites.pt', $2)`, [org, viewerRole])).invitation_id);
  await asUser(db, ana, (t) => t.query(`select public.invite_member($1, 'nova@convites.pt', $2)`, [org, viewerRole]));
});

describe("convites pendentes da própria pessoa", () => {
  it("a convidada vê o convite, com a organização e a função, sem o token", async () => {
    const list = await asUser(db, bia, (t) => rows(t, `select * from public.my_invitations()`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: invitation, organization_id: org, organization_name: "Convites Lda", role_key: "viewer" });
    expect(Object.keys(list[0]!)).not.toContain("token_hash");
  });

  it("outras pessoas, a proprietária e contas com email por confirmar não veem convites alheios", async () => {
    expect(await asUser(db, caio, (t) => rows(t, `select * from public.my_invitations()`))).toHaveLength(0);
    expect(await asUser(db, ana, (t) => rows(t, `select * from public.my_invitations()`))).toHaveLength(0);
    expect(await asUser(db, naoConfirmada, (t) => rows(t, `select * from public.my_invitations()`))).toHaveLength(0);
  });

  it("ninguém aceita um convite de outra pessoa, mesmo com o id; o erro não revela que existe", async () => {
    await expect(asUser(db, caio, (t) => t.query(`select public.accept_my_invitation($1)`, [invitation]))).rejects.toThrow(/invitation_invalid/);
    await expect(asUser(db, naoConfirmada, (t) => t.query(`select public.accept_my_invitation($1)`, [invitation]))).rejects.toThrow(/invitation_invalid/);
    expect(await asUser(db, caio, (t) => rows(t, `select id from public.workspaces where id = $1`, [org]))).toHaveLength(0);
  });

  it("anónimos não chamam as funções", async () => {
    await expect(asUser(db, null, (t) => t.query(`select * from public.my_invitations()`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (t) => t.query(`select public.accept_my_invitation($1)`, [invitation]))).rejects.toThrow(/permission denied/);
  });

  it("aceitar torna-a membro com a função do convite, ativa o workspace e tira o convite da lista", async () => {
    const id = await asUser(db, bia, (t) => one<{ id: string }>(t, `select public.accept_my_invitation($1) as id`, [invitation]));
    expect(id.id).toBe(org);
    const member = await asUser(db, bia, (t) => one<Row>(t, `select role_key, status from public.workspace_members where workspace_id = $1 and user_id = $2`, [org, bia]));
    expect(member).toEqual({ role_key: "viewer", status: "active" });
    expect(await asUser(db, bia, (t) => one<Row>(t, `select active_organization_id from public.user_preferences`))).toEqual({ active_organization_id: org });
    expect(await asUser(db, bia, (t) => rows(t, `select * from public.my_invitations()`))).toHaveLength(0);
  });

  it("não se aceita duas vezes", async () => {
    await expect(asUser(db, bia, (t) => t.query(`select public.accept_my_invitation($1)`, [invitation]))).rejects.toThrow(/invitation_invalid/);
  });

  it("convites revogados ou expirados não aparecem nem se aceitam", async () => {
    const revoked = await asUser(db, ana, async (t) => (await one<{ invitation_id: string }>(t, `select invitation_id from public.invite_member($1, 'caio@convites.pt', $2)`, [org, viewerRole])).invitation_id);
    expect(await asUser(db, caio, (t) => rows(t, `select id from public.my_invitations()`))).toHaveLength(1);
    await asUser(db, ana, (t) => t.query(`select public.revoke_invitation($1)`, [revoked]));
    expect(await asUser(db, caio, (t) => rows(t, `select id from public.my_invitations()`))).toHaveLength(0);
    await expect(asUser(db, caio, (t) => t.query(`select public.accept_my_invitation($1)`, [revoked]))).rejects.toThrow(/invitation_invalid/);

    const expired = await asUser(db, ana, async (t) => (await one<{ invitation_id: string }>(t, `select invitation_id from public.invite_member($1, 'caio@convites.pt', $2)`, [org, viewerRole])).invitation_id);
    await db.query(`update public.organization_invitations set expires_at = now() - interval '1 minute' where id = $1`, [expired]);
    expect(await asUser(db, caio, (t) => rows(t, `select id from public.my_invitations()`))).toHaveLength(0);
    await expect(asUser(db, caio, (t) => t.query(`select public.accept_my_invitation($1)`, [expired]))).rejects.toThrow(/invitation_invalid/);
  });
});
