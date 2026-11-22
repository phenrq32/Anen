import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária
let leo: string; // membro (leitor)
let rui: string; // outra pessoa
let org: string;

const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const insert = (tx: Transaction, user: string, scope: string | null, to = "2026-11-22", kind = "week") =>
  tx.query(
    `insert into public.ai_digests (user_id, organization_id, period_kind, period_from, period_to, content) values ($1, $2, $3, '2026-11-16', $4, 'Resumo') returning id`,
    [user, scope, kind, to],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@dig.pt");
  leo = await createUser(db, "leo@dig.pt");
  rui = await createUser(db, "rui@dig.pt");
  org = await asUser(db, ana, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('business', 'Dig Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).rows[0]!.id);
  const token = await asUser(db, ana, async (tx) => {
    const r = (await tx.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
    return (await tx.query<{ token: string }>(`select token from public.invite_member($1, 'leo@dig.pt', $2)`, [org, r])).rows[0]!.token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
});

describe("resumos da IA (ai_digests)", () => {
  it("são da própria pessoa: outros membros, outras pessoas e anónimos não leem nem escrevem", async () => {
    await asUser(db, leo, (tx) => insert(tx, leo, org));
    await asUser(db, ana, (tx) => insert(tx, ana, null));
    expect(await asUser(db, leo, (tx) => rows(tx, `select id from public.ai_digests`))).toHaveLength(1);
    expect(await asUser(db, ana, (tx) => rows(tx, `select organization_id from public.ai_digests`))).toEqual([{ organization_id: null }]);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.ai_digests`))).toHaveLength(0);
    // Em nome de outra pessoa, ou numa organização de que não é membro: recusado.
    await expect(asUser(db, rui, (tx) => insert(tx, ana, null))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, rui, (tx) => insert(tx, rui, org))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, null, (tx) => rows(tx, `select * from public.ai_digests`))).rejects.toThrow(/permission denied/);
    // Não se edita: gera-se outro (apagando o anterior).
    await expect(asUser(db, leo, (tx) => tx.query(`update public.ai_digests set content = 'x'`))).rejects.toThrow(/permission denied/);
    // Apagar só os seus.
    expect((await asUser(db, rui, (tx) => tx.query(`delete from public.ai_digests returning id`))).rows).toHaveLength(0);
  });

  it("um por pessoa, âmbito, tipo e dia; períodos inválidos recusados", async () => {
    await expect(asUser(db, ana, (tx) => insert(tx, ana, null))).rejects.toThrow(/duplicate key/);
    await asUser(db, ana, (tx) => insert(tx, ana, null, "2026-11-22", "month"));
    await asUser(db, ana, (tx) => insert(tx, ana, org));
    await expect(asUser(db, ana, (tx) => insert(tx, ana, null, "2026-11-01"))).rejects.toThrow(/ai_digests_period/);
    await expect(asUser(db, ana, (tx) => insert(tx, ana, null, "2026-11-23", "day"))).rejects.toThrow(/check/);
  });

  it("quem sai da organização deixa de ver os resumos dela; apagar a conta apaga-os", async () => {
    const member = (await db.query<{ id: string }>(`select id from public.organization_members where user_id = $1`, [leo])).rows[0]!.id;
    const viewer = (await db.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
    await asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'suspended')`, [member, viewer]));
    expect(await asUser(db, leo, (tx) => rows(tx, `select id from public.ai_digests`))).toHaveLength(0);
    await db.query(`delete from auth.users where id = $1`, [leo]);
    expect((await db.query(`select id from public.ai_digests where user_id = $1`, [leo])).rows).toHaveLength(0);
  });
});
