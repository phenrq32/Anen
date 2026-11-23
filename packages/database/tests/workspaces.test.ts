import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

/** Dual Workspace · Fase 2: vistas workspaces/workspace_members, can_access_workspace e ensure_personal_workspace. */
let db: PGlite;
let ana: string; // proprietária da Empresa A
let leo: string; // leitor na Empresa A
let rui: string; // proprietário da Empresa B, sem relação com a A
let empresaA: string;
let empresaB: string;
let leoMember: string;

type Row = Record<string, unknown>;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<Row>(sql, params)).rows;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@ws.pt", { full_name: "Ana" });
  leo = await createUser(db, "leo@ws.pt");
  rui = await createUser(db, "rui@ws.br", { locale: "pt-BR" });
  empresaA = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, `select public.create_organization('business', 'Empresa A', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  empresaB = await asUser(db, rui, async (t) => (await one<{ id: string }>(t, `select public.create_organization('independent', 'Empresa B', 'BR', 'BRL', 'America/Sao_Paulo') as id`)).id);
  const token = await asUser(db, ana, async (t) => {
    const role = (await one<{ id: string }>(t, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(t, `select token from public.invite_member($1, 'leo@ws.pt', $2)`, [empresaA, role])).token;
  });
  leoMember = await asUser(db, leo, (t) => one<{ id: string }>(t, `select public.accept_invitation($1) as id`, [token])).then(
    async () => (await db.query<{ id: string }>(`select id from public.organization_members where user_id = $1`, [leo])).rows[0]!.id,
  );
});

describe("espaço pessoal", () => {
  it("cada conta nova tem exatamente um espaço pessoal, com o seu id", async () => {
    for (const user of [ana, leo, rui]) {
      const personal = await asUser(db, user, (t) => rows(t, `select id, owner_user_id from public.workspaces where type = 'PERSONAL'`));
      expect(personal).toEqual([{ id: user, owner_user_id: user }]);
    }
  });

  it("segue o idioma do registo (pt-BR → BRL, São Paulo)", async () => {
    const ws = await asUser(db, rui, (t) => one<Row>(t, `select currency_code, timezone, language_code, country_code from public.workspaces where type = 'PERSONAL'`));
    expect(ws).toEqual({ currency_code: "BRL", timezone: "America/Sao_Paulo", language_code: "pt-BR", country_code: "BR" });
  });

  it("ensure_personal_workspace é idempotente e não altera preferências existentes", async () => {
    await asUser(db, ana, (t) => t.query(`update public.user_preferences set currency_code = 'BRL' where user_id = $1`, [ana]));
    for (let i = 0; i < 3; i++) {
      const id = await asUser(db, ana, (t) => one<{ id: string }>(t, `select public.ensure_personal_workspace() as id`));
      expect(id.id).toBe(ana);
    }
    const counts = await db.query<{ p: number; q: number }>(
      `select (select count(*) from public.users_profiles where id = $1)::int as p, (select count(*) from public.user_preferences where user_id = $1)::int as q`,
      [ana],
    );
    expect(counts.rows[0]).toEqual({ p: 1, q: 1 });
    const prefs = await asUser(db, ana, (t) => one<{ currency_code: string }>(t, `select currency_code from public.user_preferences`));
    expect(prefs.currency_code).toBe("BRL");
    await asUser(db, ana, (t) => t.query(`update public.user_preferences set currency_code = 'EUR' where user_id = $1`, [ana]));
  });

  it("repõe o espaço pessoal de uma conta a que falte (conta antiga)", async () => {
    const old = await createUser(db, "antiga@ws.pt");
    await db.query(`delete from public.user_preferences where user_id = $1`, [old]);
    await db.query(`delete from public.users_profiles where id = $1`, [old]);
    expect(await asUser(db, old, (t) => rows(t, `select id from public.workspaces`))).toHaveLength(0);
    await asUser(db, old, (t) => t.query(`select public.ensure_personal_workspace()`));
    expect(await asUser(db, old, (t) => rows(t, `select id, type from public.workspaces`))).toEqual([{ id: old, type: "PERSONAL" }]);
  });

  it("anónimos não chamam ensure_personal_workspace nem leem as vistas", async () => {
    await expect(asUser(db, null, (t) => t.query(`select public.ensure_personal_workspace()`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (t) => t.query(`select * from public.workspaces`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (t) => t.query(`select * from public.workspace_members`))).rejects.toThrow(/permission denied/);
  });
});

describe("organizações como espaços empresariais", () => {
  it("cada pessoa vê o seu pessoal e só as organizações de que é membro ativo", async () => {
    const list = async (user: string) =>
      (await asUser(db, user, (t) => rows(t, `select id, type, name from public.workspaces order by type desc, name`))).map((r) => [r["type"], r["id"]]);
    expect(await list(ana)).toEqual([["PERSONAL", ana], ["BUSINESS", empresaA]]);
    expect(await list(leo)).toEqual([["PERSONAL", leo], ["BUSINESS", empresaA]]);
    expect(await list(rui)).toEqual([["PERSONAL", rui], ["BUSINESS", empresaB]]);
  });

  it("os dois tipos de organização (empresa e independente) são BUSINESS", async () => {
    const b = await asUser(db, rui, (t) => one<Row>(t, `select type, organization_kind, currency_code from public.workspaces where id = $1`, [empresaB]));
    expect(b).toEqual({ type: "BUSINESS", organization_kind: "independent", currency_code: "BRL" });
  });

  it("conhecer o id de outra organização ou de outra pessoa não dá acesso", async () => {
    expect(await asUser(db, rui, (t) => rows(t, `select id from public.workspaces where id in ($1, $2)`, [empresaA, ana]))).toHaveLength(0);
    expect(await asUser(db, rui, (t) => rows(t, `select user_id from public.workspace_members where workspace_id in ($1, $2)`, [empresaA, ana]))).toHaveLength(0);
    const access = await asUser(db, rui, (t) =>
      one<Row>(
        t,
        `select public.can_access_workspace('BUSINESS', $1) as org, public.can_access_workspace('PERSONAL', $2) as personal, public.can_access_workspace('PERSONAL', $3) as own`,
        [empresaA, ana, rui],
      ),
    );
    expect(access).toEqual({ org: false, personal: false, own: true });
  });

  it("os dados pessoais da proprietária não aparecem aos membros da organização", async () => {
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.workspaces where id = $1`, [ana]))).toHaveLength(0);
    expect(await asUser(db, leo, (t) => one<Row>(t, `select public.can_access_workspace('PERSONAL', $1) as ok`, [ana]))).toEqual({ ok: false });
  });

  it("membros: o pessoal só tem o próprio; a organização tem os membros com a função", async () => {
    const personal = await asUser(db, leo, (t) => rows(t, `select user_id, role_key from public.workspace_members where workspace_type = 'PERSONAL'`));
    expect(personal).toEqual([{ user_id: leo, role_key: "owner" }]);
    const members = await asUser(db, leo, (t) =>
      rows(t, `select user_id, role_key, status from public.workspace_members where workspace_id = $1 order by role_key`, [empresaA]),
    );
    expect(members).toEqual([
      { user_id: ana, role_key: "owner", status: "active" },
      { user_id: leo, role_key: "viewer", status: "active" },
    ]);
  });

  it("permissões: o leitor é membro mas não convida; a proprietária convida", async () => {
    const check = (user: string) =>
      asUser(db, user, (t) =>
        one<Row>(t, `select public.can_access_workspace('BUSINESS', $1) as member, public.can_access_workspace('BUSINESS', $1, 'members.invite') as invite`, [empresaA]),
      );
    expect(await check(leo)).toEqual({ member: true, invite: false });
    expect(await check(ana)).toEqual({ member: true, invite: true });
  });

  it("um membro suspenso deixa de ver o espaço da organização", async () => {
    const viewer = (await db.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
    await asUser(db, ana, (t) => t.query(`select public.update_member($1, $2, 'suspended')`, [leoMember, viewer]));
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.workspaces where type = 'BUSINESS'`))).toHaveLength(0);
    expect(await asUser(db, leo, (t) => one<Row>(t, `select public.can_access_workspace('BUSINESS', $1) as ok`, [empresaA]))).toEqual({ ok: false });
    await asUser(db, ana, (t) => t.query(`select public.update_member($1, $2, 'active')`, [leoMember, viewer]));
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.workspaces where type = 'BUSINESS'`))).toHaveLength(1);
  });

  it("tipo desconhecido ou id vazio nunca dá acesso", async () => {
    const r = await asUser(db, ana, (t) =>
      one<Row>(t, `select public.can_access_workspace('FAMILY', $1) as fam, public.can_access_workspace('PERSONAL', null) as nul`, [ana]),
    );
    expect(r).toEqual({ fam: false, nul: false });
  });
});

describe("as vistas são só de leitura", () => {
  it("não se insere, altera nem apaga através delas", async () => {
    await expect(asUser(db, ana, (t) => t.query(`insert into public.workspaces (id, type) values (gen_random_uuid(), 'BUSINESS')`))).rejects.toThrow(/permission denied|cannot (insert into|update|delete from) view/);
    await expect(asUser(db, ana, (t) => t.query(`update public.workspaces set name = 'X' where id = $1`, [empresaA]))).rejects.toThrow(/permission denied|cannot (insert into|update|delete from) view/);
    await expect(asUser(db, ana, (t) => t.query(`delete from public.workspace_members where workspace_id = $1`, [empresaA]))).rejects.toThrow(/permission denied|cannot (insert into|update|delete from) view/);
  });
});
