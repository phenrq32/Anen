import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Dual Workspace · Fase 9 (§11): limites por plano, versionados e validados na base de dados (migration 3600).

let db: PGlite;
let ana: string;
let admin: string;
let bea: string;
let org: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;
const today = new Date().toISOString().slice(0, 10);
const setLimit = (plan: string, key: string, value: number | null, validFrom = today) =>
  db.query(
    `insert into public.plan_limits (plan_key, limit_key, value, valid_from, source) values ($1, $2, $3, $4, 'teste')
     on conflict (plan_key, limit_key, valid_from) do update set value = excluded.value`,
    [plan, key, value, validFrom],
  );
const newProject = (name: string) =>
  asUser(db, ana, (tx) => tx.query(`insert into public.projects (organization_id, name, currency_code) values ($1, $2, 'EUR')`, [org, name]));

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@limites.pt");
  admin = await createUser(db, "admin@limites.pt");
  bea = await createUser(db, "bea@limites.pt");
  await db.query(`insert into public.admin_users (user_id, role) values ($1, 'super_admin')`, [admin]);
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Limites Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
});

describe("limites dos planos", () => {
  it("por omissão não há limites (decisão do dono da app): todos os valores são nulos e com fonte", async () => {
    const r = await asUser(db, ana, (tx) => tx.query<{ value: number | null; source: string }>(`select value, source from public.plan_limits`));
    expect(r.rows.length).toBe(15);
    expect(r.rows.every((x) => x.value === null && x.source.length > 0)).toBe(true);
    for (let i = 0; i < 5; i++) await newProject(`Projeto ${i}`);
  });

  it("com limite definido, o servidor recusa a criação acima do limite; um plano superior tem o seu próprio limite", async () => {
    await setLimit("free", "projects", 6);
    await newProject("Sexto");
    await expect(newProject("Sétimo")).rejects.toThrow(/plan_limit_reached/);
    await db.query(`insert into public.subscriptions (organization_id, plan_key) values ($1, 'pro')`, [org]);
    await newProject("Sétimo no Pro");
    await db.query(`update public.subscriptions set status = 'canceled' where organization_id = $1`, [org]);
    await setLimit("free", "projects", null);
  });

  it("organizações contam pelo plano da conta de quem cria", async () => {
    await setLimit("free", "organizations", 1);
    await expect(asUser(db, ana, (tx) => tx.query(`select public.create_organization('business', 'Segunda Lda', 'PT', 'EUR', 'Europe/Lisbon')`))).rejects.toThrow(
      /plan_limit_reached/,
    );
    // Outra pessoa, sem organizações, ainda pode criar uma
    await asUser(db, bea, (tx) => tx.query(`select public.create_organization('business', 'Bea Lda', 'PT', 'EUR', 'Europe/Lisbon')`));
    await setLimit("free", "organizations", null);
  });

  it("membros ativos por organização", async () => {
    await setLimit("free", "members", 1);
    const token = await asUser(db, ana, async (tx) => {
      const role = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
      return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'bea@limites.pt', $2)`, [org, role])).token;
    });
    await expect(asUser(db, bea, (tx) => tx.query(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/plan_limit_reached/);
    await setLimit("free", "members", null);
    await asUser(db, bea, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  });

  it("uma versão com data futura ainda não está em vigor", async () => {
    await setLimit("free", "projects", 0, "2099-01-01");
    await newProject("Ainda sem limite");
  });

  it("só administradores da plataforma mudam limites; anónimos não leem", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select public.admin_set_plan_limit('free', 'projects', 1, 'x')`))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, ana, (tx) => tx.query(`insert into public.plan_limits (plan_key, limit_key, value, valid_from, source) values ('free', 'projects', 1, current_date, 'x')`))).rejects.toThrow(
      /permission denied/,
    );
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_plan_limit('max', 'market_watches', 50, 'Política comercial 2027')`));
    const r = await asUser(db, ana, (tx) => one<{ value: number }>(tx, `select value from public.plan_limits where plan_key = 'max' and limit_key = 'market_watches' and valid_from = current_date`));
    expect(r.value).toBe(50);
    await expect(asUser(db, null, (tx) => tx.query(`select 1 from public.plan_limits`))).rejects.toThrow(/permission denied/);
  });
});
