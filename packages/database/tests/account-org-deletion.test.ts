import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Apagar a própria conta, sair e apagar uma organização (migration 2200).

let db: PGlite;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const n = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
const newOrg = (user: string, name: string) =>
  asUser(db, user, async (tx) => (await one<{ id: string }>(tx, `select public.create_organization('business', $1, 'PT', 'EUR', 'Europe/Lisbon') as id`, [name])).id);
async function invite(owner: string, org: string, email: string, user: string, role = "employee") {
  const token = await asUser(db, owner, async (tx) => {
    const r = (await one<{ id: string }>(tx, `select id from public.roles where key = $1 and organization_id is null`, [role])).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [org, email, r])).token;
  });
  await asUser(db, user, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
}
const memberId = async (org: string, user: string) =>
  (await db.query<{ id: string }>(`select id from public.organization_members where organization_id = $1 and user_id = $2`, [org, user])).rows[0]!.id;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("apagar a própria conta", () => {
  it("exige o email certo, apaga os dados pessoais e a organização em que estava sozinha", async () => {
    const ana = await createUser(db, "ana@apagar.pt");
    const solo = await newOrg(ana, "Sozinha Lda");
    await asUser(db, ana, (tx) => tx.query(`insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'C', 'cash', 'EUR')`, [ana]));
    await expect(asUser(db, ana, (tx) => tx.query(`select public.delete_my_account('outra@pessoa.pt')`))).rejects.toThrow(/confirmation_mismatch/);
    await asUser(db, ana, (tx) => tx.query(`select public.delete_my_account('  ANA@apagar.pt ')`));
    expect(await n(`select count(*)::int as n from auth.users where id = $1`, [ana])).toBe(0);
    expect(await n(`select count(*)::int as n from public.financial_accounts where owner_user_id = $1`, [ana])).toBe(0);
    expect(await n(`select count(*)::int as n from public.organizations where id = $1`, [solo])).toBe(0);
  });

  it("única proprietária com outros membros: tem de passar a propriedade primeiro; depois sai e a organização fica", async () => {
    const bia = await createUser(db, "bia@apagar.pt");
    const caio = await createUser(db, "caio@apagar.pt");
    const org = await newOrg(bia, "Equipa Lda");
    await invite(bia, org, "caio@apagar.pt", caio);
    await expect(asUser(db, bia, (tx) => tx.query(`select public.delete_my_account('bia@apagar.pt')`))).rejects.toThrow(/owner_must_transfer/);
    expect(await n(`select count(*)::int as n from auth.users where id = $1`, [bia])).toBe(1);
    const owner = (await db.query<{ id: string }>(`select id from public.roles where key = 'owner' and organization_id is null`)).rows[0]!.id;
    const caioMember = await memberId(org, caio);
    await asUser(db, bia, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [caioMember, owner]));
    await asUser(db, bia, (tx) => tx.query(`select public.delete_my_account('bia@apagar.pt')`));
    expect(await n(`select count(*)::int as n from public.organizations where id = $1`, [org])).toBe(1);
    expect(await n(`select count(*)::int as n from public.organization_members where organization_id = $1`, [org])).toBe(1);
  });

  it("anónimos não chamam a função", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select public.delete_my_account('x@y.pt')`))).rejects.toThrow(/permission denied/);
  });
});

describe("sair e apagar uma organização", () => {
  it("um membro sai; a última proprietária não sai sem passar a propriedade", async () => {
    const dora = await createUser(db, "dora@org.pt");
    const edu = await createUser(db, "edu@org.pt");
    const org = await newOrg(dora, "Sair Lda");
    await invite(dora, org, "edu@org.pt", edu);
    const [eduMember, doraMember] = [await memberId(org, edu), await memberId(org, dora)];
    await asUser(db, edu, (tx) => tx.query(`select public.remove_member($1)`, [eduMember]));
    expect(await n(`select count(*)::int as n from public.organization_members where organization_id = $1 and user_id = $2`, [org, edu])).toBe(0);
    await expect(asUser(db, dora, (tx) => tx.query(`select public.remove_member($1)`, [doraMember]))).rejects.toThrow(/last_owner/);
  });

  it("só uma proprietária apaga, confirmando o nome; tudo o que era da organização vai junto", async () => {
    const fia = await createUser(db, "fia@org.pt");
    const gil = await createUser(db, "gil@org.pt");
    const rui = await createUser(db, "rui@org.pt");
    const org = await newOrg(fia, "Apagar Esta Lda");
    await invite(fia, org, "gil@org.pt", gil, "admin");
    await asUser(db, fia, (tx) => tx.query(`insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'C', 'cash', 'EUR')`, [org]));
    await expect(asUser(db, gil, (tx) => tx.query(`select public.delete_organization($1, 'Apagar Esta Lda')`, [org]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, rui, (tx) => tx.query(`select public.delete_organization($1, 'Apagar Esta Lda')`, [org]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, fia, (tx) => tx.query(`select public.delete_organization($1, 'apagar esta')`, [org]))).rejects.toThrow(/confirmation_mismatch/);
    await asUser(db, fia, (tx) => tx.query(`select public.delete_organization($1, ' Apagar Esta Lda ')`, [org]));
    expect(await n(`select count(*)::int as n from public.organizations where id = $1`, [org])).toBe(0);
    expect(await n(`select count(*)::int as n from public.financial_accounts where organization_id = $1`, [org])).toBe(0);
    expect(await n(`select count(*)::int as n from public.organization_members where organization_id = $1`, [org])).toBe(0);
    expect(await n(`select count(*)::int as n from auth.users where id = $1`, [gil])).toBe(1);
  });
});

describe("apagar notificações", () => {
  it("cada pessoa apaga só as suas", async () => {
    const hugo = await createUser(db, "hugo@notif.pt");
    const ines = await createUser(db, "ines@notif.pt");
    for (const u of [hugo, ines]) {
      await db.query(`insert into public.notifications (user_id, kind, data, link, dedupe_key) values ($1, 'market_alert', '{}', '/mercado', $2)`, [u, `t:${u}`]);
    }
    expect(await asUser(db, hugo, async (tx) => (await tx.query(`delete from public.notifications where user_id = $1 returning id`, [ines])).rows.length)).toBe(0);
    expect(await asUser(db, hugo, async (tx) => (await tx.query(`delete from public.notifications returning id`)).rows.length)).toBe(1);
    expect(await n(`select count(*)::int as n from public.notifications where user_id = $1`, [ines])).toBe(1);
  });

  it("dispensar marca a notificação, que não volta a ser criada pela tarefa diária", async () => {
    const joao = await createUser(db, "joao@notif.pt");
    await db.query(`insert into public.notifications (user_id, kind, data, link, dedupe_key) values ($1, 'market_alert', '{}', '/mercado', 'k1')`, [joao]);
    await asUser(db, joao, (tx) => tx.query(`update public.notifications set dismissed_at = now()`));
    await db.query(`insert into public.notifications (user_id, kind, data, link, dedupe_key) values ($1, 'market_alert', '{}', '/mercado', 'k1') on conflict (user_id, dedupe_key) do nothing`, [joao]);
    expect(await n(`select count(*)::int as n from public.notifications where user_id = $1 and dismissed_at is null`, [joao])).toBe(0);
    await expect(asUser(db, joao, (tx) => tx.query(`update public.notifications set kind = 'payment_overdue'`))).rejects.toThrow(/permission denied/);
  });
});
