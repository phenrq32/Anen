import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

/**
 * Dual Workspace · Fase 3: invariantes de isolamento verificadas em TODAS as tabelas que pertencem
 * a um workspace (com organization_id e/ou owner_user_id), incluindo as que vierem a ser criadas.
 * Os testes de dados por tabela (business, finance, inventory, …) provam os acessos cruzados concretos.
 */
let db: PGlite;
let scoped: { table: string; hasOrg: boolean; hasOwner: boolean }[];

/** Tabelas com organization_id que não são dados de um workspace (ou têm regras próprias, testadas à parte). */
const NOT_WORKSPACE_DATA = new Set([
  "audit_logs", // registo histórico, sem FK, legível com audit.read
  "organization_members", // membros (RPCs e testes de RLS próprios)
  "organization_invitations",
  "roles", // funções de sistema têm organization_id nulo
]);

/** Dados de uma pessoa, com a organização opcional (user_id obrigatório; RLS por user_id e testes próprios). */
const PER_PERSON = new Set(["ai_conversations", "ai_digests", "notifications"]);

beforeAll(async () => {
  db = await createTestDatabase();
  const res = await db.query<{ table_name: string; has_org: boolean; has_owner: boolean }>(`
    select c.table_name,
           bool_or(c.column_name = 'organization_id') as has_org,
           bool_or(c.column_name = 'owner_user_id') as has_owner
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('organization_id', 'owner_user_id')
    group by c.table_name
    order by c.table_name`);
  scoped = res.rows
    .filter((r) => !NOT_WORKSPACE_DATA.has(r.table_name))
    .map((r) => ({ table: r.table_name, hasOrg: r.has_org, hasOwner: r.has_owner }));
});

describe("isolamento por workspace em todas as tabelas", () => {
  it("encontra as tabelas de workspace (o teste não está vazio)", () => {
    expect(scoped.length).toBeGreaterThanOrEqual(30);
    for (const t of ["transactions", "financial_accounts", "contacts", "projects", "quotes", "stock_items", "ai_conversations"]) {
      expect(scoped.map((s) => s.table)).toContain(t);
    }
  });

  it("todas têm RLS ativo", async () => {
    const res = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1) and not c.relrowsecurity`,
      [scoped.map((s) => s.table)],
    );
    expect(res.rows.map((r) => r.relname)).toEqual([]);
  });

  it("os anónimos não têm nenhum privilégio", async () => {
    const res = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon' and table_name = any($1)`,
      [scoped.map((s) => s.table)],
    );
    expect(res.rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([]);
  });

  it("o workspace de um registo não muda numa edição: gatilho workspace_immutable em todas", async () => {
    const res = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'workspace_immutable' and t.tgenabled <> 'D')`,
      [scoped.map((s) => s.table)],
    );
    expect(res.rows.map((r) => r.relname)).toEqual([]);
  });

  it("cada registo pertence a um único workspace (restrição XOR ou organization_id obrigatório)", async () => {
    const offenders: string[] = [];
    for (const s of scoped) {
      const checks = await db.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and contype = 'c'`,
        [`public.${s.table}`],
      );
      const xor = checks.rows.some((c) => /organization_id IS NULL\) <> \(owner_user_id IS NULL/.test(c.def));
      const notNullOrg = s.hasOrg
        ? (
            await db.query<{ n: string }>(
              `select is_nullable as n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'organization_id'`,
              [s.table],
            )
          ).rows[0]?.n === "NO"
        : false;
      const notNullOwner = s.hasOwner && !s.hasOrg
        ? (
            await db.query<{ n: string }>(
              `select is_nullable as n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'owner_user_id'`,
              [s.table],
            )
          ).rows[0]?.n === "NO"
        : false;
      if (PER_PERSON.has(s.table)) {
        const r = await db.query<{ n: string }>(
          `select is_nullable as n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'user_id'`,
          [s.table],
        );
        if (r.rows[0]?.n !== "NO") offenders.push(`${s.table} (user_id opcional)`);
        continue;
      }
      if (!xor && !notNullOrg && !notNullOwner) offenders.push(s.table);
    }
    expect(offenders).toEqual([]);
  });

  it("nenhuma política está aberta a todos (using true) nem a anónimos", async () => {
    const res = await db.query<{ tablename: string; policyname: string; roles: string[]; qual: string | null; with_check: string | null }>(
      `select tablename, policyname, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = any($1)`,
      [scoped.map((s) => s.table)],
    );
    const open = res.rows
      .filter((p) => p.qual === "true" || p.with_check === "true" || p.roles.includes("anon") || p.roles.includes("public"))
      .map((p) => `${p.tablename}: ${p.policyname}`);
    expect(open).toEqual([]);
  });

  it("todas as políticas dependem de quem pede (auth.uid ou permissões da organização)", async () => {
    const res = await db.query<{ tablename: string; policyname: string; expr: string }>(
      `select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
       from pg_policies where schemaname = 'public' and tablename = any($1)`,
      [scoped.map((s) => s.table)],
    );
    const unbound = res.rows
      .filter((p) => !/auth\.uid\(\)|has_org_permission|is_org_member|can_access|can_read|can_write|private\./.test(p.expr))
      .map((p) => `${p.tablename}: ${p.policyname}`);
    expect(unbound).toEqual([]);
  });
});

describe("mover um registo entre workspaces numa edição é recusado", () => {
  let ana: string;
  let org: string;
  let other: string;

  beforeAll(async () => {
    ana = await createUser(db, "ana@mover.pt");
    [org, other] = await asUser(db, ana, async (t) => [
      (await t.query<{ id: string }>(`select public.create_organization('business', 'Empresa M', 'PT', 'EUR', 'Europe/Lisbon') as id`)).rows[0]!.id,
      (await t.query<{ id: string }>(`select public.create_organization('business', 'Empresa N', 'PT', 'EUR', 'Europe/Lisbon') as id`)).rows[0]!.id,
    ]);
  });

  // A Ana é proprietária das duas empresas e dona do pessoal: tem escrita em todos os destinos.
  const cases = [
    { table: "financial_accounts", insert: `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id` },
    { table: "budgets", insert: `insert into public.budgets (organization_id, category_id, period_start, amount_minor, currency_code) values ($1, (select id from public.transaction_categories where is_system and kind = 'expense' order by id limit 1), '2026-11-01', 1000, 'EUR') returning id` },
    { table: "savings_goals", insert: `insert into public.savings_goals (organization_id, name, target_minor, saved_minor, currency_code) values ($1, 'Reserva', 1000, 0, 'EUR') returning id` },
    { table: "contacts", insert: `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Cliente') returning id` },
  ];

  for (const c of cases) {
    it(`${c.table}: nem para o pessoal nem para outra empresa`, async () => {
      const id = await asUser(db, ana, async (t) => (await t.query<{ id: string }>(c.insert, [org])).rows[0]!.id);
      await expect(
        asUser(db, ana, (t) => t.query(`update public.${c.table} set organization_id = null, owner_user_id = $1 where id = $2`, [ana, id])),
      ).rejects.toThrow(/workspace_immutable|forbidden|permission denied/);
      await expect(asUser(db, ana, (t) => t.query(`update public.${c.table} set organization_id = $1 where id = $2`, [other, id]))).rejects.toThrow(
        /workspace_immutable|forbidden|permission denied/,
      );
      // Nem sem RLS (service_role) o consegue: a regra está nos gatilhos.
      await expect(db.query(`update public.${c.table} set organization_id = $1 where id = $2`, [other, id])).rejects.toThrow(/workspace_immutable|forbidden/);
      const still = await db.query<{ organization_id: string }>(`select organization_id from public.${c.table} where id = $1`, [id]);
      expect(still.rows[0]?.organization_id).toBe(org);
    });
  }

  it("numa tabela sem gatilho próprio (categorias), a guarda workspace_immutable atua sozinha", async () => {
    const id = await asUser(db, ana, async (t) =>
      (await t.query<{ id: string }>(`insert into public.transaction_categories (organization_id, kind, name) values ($1, 'expense', 'Obras') returning id`, [org])).rows[0]!.id,
    );
    await expect(db.query(`update public.transaction_categories set organization_id = $1 where id = $2`, [other, id])).rejects.toThrow(/workspace_immutable/);
    await expect(db.query(`update public.transaction_categories set organization_id = null, owner_user_id = $1 where id = $2`, [ana, id])).rejects.toThrow(
      /workspace_immutable/,
    );
  });

  it("as edições normais continuam a funcionar", async () => {
    const id = await asUser(db, ana, async (t) => (await t.query<{ id: string }>(cases[0]!.insert, [org])).rows[0]!.id);
    await asUser(db, ana, (t) => t.query(`update public.financial_accounts set name = 'Banco 2' where id = $1`, [id]));
    expect((await db.query<{ name: string }>(`select name from public.financial_accounts where id = $1`, [id])).rows[0]?.name).toBe("Banco 2");
  });

  it("as alterações a orçamentos mensais ficam na auditoria", async () => {
    const id = await asUser(db, ana, async (t) => (await t.query<{ id: string }>(cases[1]!.insert.replace("'2026-11-01'", "'2026-12-01'"), [org])).rows[0]!.id);
    const logs = await db.query<{ action: string }>(`select action from public.audit_logs where entity_type = 'budgets' and entity_id = $1`, [id]);
    expect(logs.rows.map((r) => r.action)).toEqual(["insert"]);
  });
});
