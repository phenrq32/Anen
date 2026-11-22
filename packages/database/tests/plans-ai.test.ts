import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária da organização
let leo: string; // membro (leitor)
let rui: string; // outra pessoa, sem organização
let admin: string; // administrador da plataforma
let org: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const status = (user: string, scopeOrg: string | null) =>
  asUser(db, user, (tx) => one<{ plan_key: string; daily_limit: number; used_today: number; consented: boolean }>(tx, `select * from public.ai_status($1)`, [scopeOrg]));
const begin = (user: string, scopeOrg: string | null) =>
  asUser(db, user, (tx) => one<{ usage_id: number; daily_limit: number; used_today: number }>(tx, `select * from public.ai_begin_request($1)`, [scopeOrg]));
const consent = (user: string) => asUser(db, user, (tx) => tx.query(`insert into public.ai_consents (user_id) values ($1)`, [user]));

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@ai.pt");
  leo = await createUser(db, "leo@ai.pt");
  rui = await createUser(db, "rui@ai.pt");
  admin = await createUser(db, "admin@ai.pt");
  await db.query(`insert into public.admin_users (user_id, role) values ($1, 'super_admin')`, [admin]);
  org = await asUser(db, ana, async (tx) => (await one<{ id: string }>(tx, `select public.create_organization('business', 'IA Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  const token = await asUser(db, ana, async (tx) => {
    const r = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@ai.pt', $2)`, [org, r])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
});

describe("planos", () => {
  it("Free por omissão: sem IA; os limites estão em dados", async () => {
    expect(await status(ana, org)).toMatchObject({ plan_key: "free", daily_limit: 0, used_today: 0, consented: false });
    const plans = await asUser(db, ana, (tx) => rows(tx, `select key, ai_daily_limit from public.plans order by position`));
    expect(plans).toEqual([{ key: "free", ai_daily_limit: 0 }, { key: "pro", ai_daily_limit: 25 }, { key: "max", ai_daily_limit: 100 }]);
  });

  it("só administradores da plataforma atribuem planos e mudam limites; ninguém escreve direto", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select public.admin_set_plan($1, null, 'max')`, [org]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, ana, (tx) => tx.query(`select public.admin_set_ai_limit('pro', 9999)`))).rejects.toThrow(/forbidden/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.subscriptions (organization_id, plan_key) values ($1, 'max')`, [org])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.plans set ai_daily_limit = 1000`))).rejects.toThrow(/permission denied/);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_plan($1, null, 'pro')`, [org]));
    expect((await status(ana, org)).plan_key).toBe("pro");
    expect((await status(leo, org)).plan_key).toBe("pro");
    // O plano da organização não vale para o pessoal.
    expect((await status(ana, null)).plan_key).toBe("free");
    // Trocar de plano cancela o anterior (uma subscrição ativa por âmbito).
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_plan($1, null, 'max')`, [org]));
    const subs = await asUser(db, ana, (tx) => rows(tx, `select plan_key, status from public.subscriptions where organization_id = $1 order by created_at`, [org]));
    expect(subs).toEqual([{ plan_key: "pro", status: "canceled" }, { plan_key: "max", status: "active" }]);
    // Outra pessoa não vê a subscrição da organização.
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.subscriptions`))).toHaveLength(0);
    await expect(asUser(db, rui, (tx) => tx.query(`select * from public.ai_status($1)`, [org]))).rejects.toThrow(/forbidden/);
  });

  it("plano com prazo vencido volta a Free", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_plan(null, $1, 'pro', now() - interval '1 day')`, [rui]));
    expect((await status(rui, null)).plan_key).toBe("free");
  });
});

describe("limite diário", () => {
  it("exige consentimento e plano com IA", async () => {
    await expect(begin(ana, org)).rejects.toThrow(/ai_consent_required/);
    await consent(ana);
    await expect(begin(ana, null)).rejects.toThrow(/ai_plan_required/);
  });

  it("conta por conta (organização), em todos os membros, e para no limite", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_ai_limit('max', 3)`));
    await consent(leo);
    const first = await begin(ana, org);
    expect(first).toMatchObject({ daily_limit: 3, used_today: 1 });
    await begin(leo, org);
    await begin(ana, org);
    await expect(begin(leo, org)).rejects.toThrow(/ai_daily_limit/);
    // Uma falha do fornecedor devolve a vaga.
    await asUser(db, ana, (tx) => tx.query(`select public.ai_finish_request($1, false, 'm', 0, 0)`, [first.usage_id]));
    expect((await status(ana, org)).used_today).toBe(2);
    await begin(leo, org);
    await expect(begin(ana, org)).rejects.toThrow(/ai_daily_limit/);
    // Ninguém fecha a reserva de outra pessoa nem mexe no uso diretamente.
    const mine = await begin(ana, null).catch(() => null);
    expect(mine).toBeNull();
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.ai_usage`))).rejects.toThrow(/permission denied/);
    expect(await asUser(db, ana, (tx) => rows(tx, `select * from public.ai_usage`))).toHaveLength(0);
    expect((await asUser(db, admin, (tx) => rows(tx, `select * from public.ai_usage`))).length).toBeGreaterThan(0);
  });

  it("anónimos não usam nada", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.ai_begin_request(null)`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.plans`))).rejects.toThrow(/permission denied/);
  });
});

describe("conversas", () => {
  it("são privadas de quem pergunta; as da organização somem para quem sai", async () => {
    const conv = await asUser(db, leo, async (tx) => {
      const c = (await one<{ id: string }>(tx, `insert into public.ai_conversations (user_id, organization_id, title) values ($1, $2, 'Gastos') returning id`, [leo, org])).id;
      await tx.query(`insert into public.ai_messages (conversation_id, role, content) values ($1, 'user', 'Quanto gastei?')`, [c]);
      return c;
    });
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.ai_conversations where id = $1`, [conv]))).toHaveLength(0);
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.ai_messages where conversation_id = $1`, [conv]))).toHaveLength(0);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.ai_messages (conversation_id, role, content) values ($1, 'user', 'x')`, [conv])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.ai_conversations (user_id, organization_id, title) values ($1, $2, 'x')`, [rui, org])),
    ).rejects.toThrow(/row-level security/);
    const member = (await db.query<{ id: string }>(`select id from public.organization_members where user_id = $1`, [leo])).rows[0]!.id;
    const viewer = (await db.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
    await asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'suspended')`, [member, viewer]));
    expect(await asUser(db, leo, (tx) => rows(tx, `select id from public.ai_conversations`))).toHaveLength(0);
    await expect(begin(leo, org)).rejects.toThrow(/forbidden/);
  });

  it("apagar a conta apaga as conversas e o consentimento", async () => {
    await db.query(`delete from auth.users where id = $1`, [leo]);
    expect(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.ai_conversations`)).rows[0]!.n)).toBe(0);
    expect(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.ai_consents where user_id = $1`, [leo])).rows[0]!.n)).toBe(0);
  });
});
