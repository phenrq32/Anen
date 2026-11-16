import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string;
let rui: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@plano.pt");
  rui = await createUser(db, "rui@plano.pt");
});

describe("plano do mês: acessos e integridade", () => {
  let expense: string;

  it("a pessoa regista o salário e despesas fixas e altera o valor", async () => {
    expense = await asUser(db, ana, async (tx) => {
      await tx.query(`insert into public.monthly_plans (owner_user_id, month, currency_code, salary_minor, emergency_reserve_minor) values ($1, '2026-11-01', 'EUR', 150000, 20000)`, [ana]);
      const id = (await tx.query<{ id: string }>(`insert into public.fixed_expenses (owner_user_id, name, amount_minor, currency_code) values ($1, 'Renda', 65000, 'EUR') returning id`, [ana])).rows[0]!.id;
      await tx.query(`update public.fixed_expenses set amount_minor = 70000 where id = $1`, [id]);
      return id;
    });
    const row = await asUser(db, ana, (tx) => tx.query<{ amount_minor: number }>(`select amount_minor from public.fixed_expenses where id = $1`, [expense]));
    expect(Number(row.rows[0]!.amount_minor)).toBe(70000);
  });

  it("um plano por mês", async () => {
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.monthly_plans (owner_user_id, month, currency_code, salary_minor) values ($1, '2026-11-01', 'EUR', 1)`, [ana])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("outra pessoa e anónimos não veem nem alteram", async () => {
    expect((await asUser(db, rui, (tx) => tx.query(`select id from public.fixed_expenses`))).rows).toHaveLength(0);
    expect((await asUser(db, rui, (tx) => tx.query(`select id from public.monthly_plans`))).rows).toHaveLength(0);
    expect((await asUser(db, rui, (tx) => tx.query(`update public.fixed_expenses set amount_minor = 1 where id = $1 returning id`, [expense]))).rows).toHaveLength(0);
    expect((await asUser(db, rui, (tx) => tx.query(`delete from public.fixed_expenses where id = $1 returning id`, [expense]))).rows).toHaveLength(0);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.fixed_expenses (owner_user_id, name, amount_minor, currency_code) values ($1, 'X', 1, 'EUR')`, [ana])),
    ).rejects.toThrow(/row-level security/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.monthly_plans`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.fixed_expenses set owner_user_id = $1 where id = $2`, [rui, expense])),
    ).rejects.toThrow();
  });

  it("categoria tem de ser de despesa e da própria pessoa ou de sistema", async () => {
    const income = (await db.query<{ id: string }>(`select id from public.transaction_categories where key = 'salary'`)).rows[0]!.id;
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.fixed_expenses (owner_user_id, name, amount_minor, currency_code, category_id) values ($1, 'X', 1, 'EUR', $2)`, [ana, income])),
    ).rejects.toThrow(/category_invalid/);
  });

  it("o catálogo de opções é público para leitura e não pode ser alterado", async () => {
    const pt = await asUser(db, null, (tx) => tx.query<{ key: string; source_url: string }>(`select key, source_url from public.investment_options where country_code = 'PT'`));
    expect(pt.rows.length).toBeGreaterThan(0);
    expect(pt.rows.every((r) => r.source_url.startsWith("https://"))).toBe(true);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.investment_options set risk = 'low'`))).rejects.toThrow(/permission denied/);
  });

  it("apagar a conta apaga o plano", async () => {
    await db.query(`delete from auth.users where id = $1`, [ana]);
    expect((await db.query(`select id from public.monthly_plans`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.fixed_expenses`)).rows).toHaveLength(0);
  });
});
