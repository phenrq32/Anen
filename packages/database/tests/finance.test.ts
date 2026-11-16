import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // dona da organização
let leo: string; // leitor na organização
let rui: string; // sem relação
let org: string;
let orgAccount: string;
let personalAccount: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;

async function systemCategory(key: string): Promise<string> {
  return (await db.query<{ id: string }>(`select id from public.transaction_categories where key = $1`, [key])).rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@fin.pt", { full_name: "Ana" });
  leo = await createUser(db, "leo@fin.pt", { full_name: "Leo" });
  rui = await createUser(db, "rui@fin.pt", { full_name: "Rui" });
  org = await asUser(db, ana, async (tx) =>
    (await one<{ id: string }>(tx, `select public.create_organization('business', 'Fin Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id,
  );
  const token = await asUser(db, ana, async (tx) => {
    const viewer = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@fin.pt', $2)`, [org, viewer])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
});

describe("contas e movimentos", () => {
  it("a dona cria uma conta da organização e uma conta pessoal", async () => {
    orgAccount = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code, opening_balance_minor) values ($1, 'Banco', 'checking', 'EUR', 100000) returning id`, [org])).id,
    );
    personalAccount = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Carteira', 'cash', 'EUR') returning id`, [ana])).id,
    );
    expect(orgAccount).toBeTruthy();
    expect(personalAccount).toBeTruthy();
  });

  it("ninguém cria registos pessoais em nome de outra pessoa", async () => {
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'X', 'cash', 'EUR')`, [ana])),
    ).rejects.toThrow(/row-level security/);
  });

  it("um âmbito tem de ser exatamente um (organização XOR pessoa)", async () => {
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.financial_accounts (organization_id, owner_user_id, name, kind, currency_code) values ($1, $2, 'X', 'cash', 'EUR')`, [org, ana])),
    ).rejects.toThrow();
  });

  it("regista movimentos, copia a moeda da conta e calcula o saldo", async () => {
    const sales = await systemCategory("sales");
    const materials = await systemCategory("materials");
    await asUser(db, ana, async (tx) => {
      await tx.query(
        `insert into public.transactions (organization_id, account_id, category_id, kind, amount_minor, currency_code, occurred_on, description)
         values ($1, $2, $3, 'income', 250000, 'BRL', '2026-11-03', 'Obra cozinha'),
                ($1, $2, $4, 'expense', 80050, 'EUR', '2026-11-05', 'Tintas')`,
        [org, orgAccount, sales, materials],
      );
    });
    const currencies = await asUser(db, ana, (tx) => rows(tx, `select distinct currency_code from public.transactions where organization_id = $1`, [org]));
    expect(currencies).toEqual([{ currency_code: "EUR" }]);
    const balance = await asUser(db, ana, (tx) => one<{ balance_minor: number }>(tx, `select balance_minor from public.account_balances($1)`, [org]));
    expect(Number(balance.balance_minor)).toBe(100000 + 250000 - 80050);
    const monthly = await asUser(db, ana, (tx) => one<{ income: number; expense: number }>(tx, `select income, expense from public.finance_monthly($1, '2026-11-01', '2026-11-30')`, [org]));
    expect([Number(monthly.income), Number(monthly.expense)]).toEqual([250000, 80050]);
  });

  it("valida a categoria (tipo e âmbito) e a conta (mesmo âmbito)", async () => {
    const sales = await systemCategory("sales");
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.transactions (organization_id, account_id, category_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, $3, 'expense', 100, 'EUR', '2026-11-05', 'x')`, [org, orgAccount, sales])),
    ).rejects.toThrow(/category_invalid/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 100, 'EUR', '2026-11-05', 'x')`, [org, personalAccount])),
    ).rejects.toThrow(/account_invalid/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', -5, 'EUR', '2026-11-05', 'x')`, [org, orgAccount])),
    ).rejects.toThrow();
    const personalCat = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.transaction_categories (owner_user_id, kind, name) values ($1, 'expense', 'Pessoal') returning id`, [ana])).id,
    );
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.transactions (organization_id, account_id, category_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, $3, 'expense', 100, 'EUR', '2026-11-05', 'x')`, [org, orgAccount, personalCat])),
    ).rejects.toThrow(/category_invalid/);
  });

  it("o leitor vê mas não escreve; quem é de fora não vê nada", async () => {
    expect((await asUser(db, leo, (tx) => rows(tx, `select id from public.transactions where organization_id = $1`, [org]))).length).toBe(2);
    await expect(
      asUser(db, leo, (tx) => tx.query(`insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 100, 'EUR', '2026-11-05', 'x')`, [org, orgAccount])),
    ).rejects.toThrow(/row-level security/);
    await asUser(db, leo, (tx) => tx.query(`update public.transactions set amount_minor = 1 where organization_id = $1`, [org]));
    await asUser(db, leo, (tx) => tx.query(`delete from public.transactions where organization_id = $1`, [org]));
    expect((await db.query(`select id from public.transactions where organization_id = $1 and amount_minor > 1`, [org])).rows.length).toBe(2);

    expect((await asUser(db, rui, (tx) => rows(tx, `select id from public.transactions`))).length).toBe(0);
    expect((await asUser(db, rui, (tx) => rows(tx, `select * from public.account_balances($1)`, [org]))).length).toBe(0);
    expect((await asUser(db, rui, (tx) => rows(tx, `select * from public.finance_monthly($1, '2026-01-01', '2026-12-31')`, [org]))).length).toBe(0);
    // As finanças pessoais da Ana não são visíveis ao Leo, mesmo sendo colega
    expect((await asUser(db, leo, (tx) => rows(tx, `select id from public.financial_accounts where owner_user_id = $1`, [ana]))).length).toBe(0);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.transactions`))).rejects.toThrow(/permission denied/);
  });

  it("não se muda um registo de âmbito nem o autor", async () => {
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.financial_accounts set organization_id = null, owner_user_id = $2 where id = $1`, [orgAccount, ana])),
    ).rejects.toThrow(/forbidden/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.transactions set created_by = $1`, [rui])),
    ).rejects.toThrow(/permission denied/);
  });

  it("a moeda de uma conta com movimentos fica bloqueada", async () => {
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.financial_accounts set currency_code = 'BRL' where id = $1`, [orgAccount])),
    ).rejects.toThrow(/account_currency_locked/);
  });

  it("categorias de sistema não são editáveis", async () => {
    await asUser(db, ana, (tx) => tx.query(`update public.transaction_categories set name = 'X' where is_system`));
    expect((await db.query<{ name: string }>(`select name from public.transaction_categories where key = 'sales'`)).rows[0]!.name).toBe("Vendas");
  });
});

describe("recorrentes", () => {
  it("gera ocorrências mensais sem duplicar e sem ressuscitar as apagadas", async () => {
    const rent = await systemCategory("rent");
    const id = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(
        tx,
        `insert into public.recurring_transactions (organization_id, account_id, category_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on)
         values ($1, $2, $3, 'expense', 50000, 'EUR', 'Renda armazém', 'monthly', '2026-01-31', '1999-01-01') returning id`,
        [org, orgAccount, rent],
      )).id,
    );
    const first = await asUser(db, ana, (tx) => one<{ n: number }>(tx, `select public.materialize_recurring($1, '2026-04-30') as n`, [org]));
    expect(first.n).toBe(4);
    const dates = await asUser(db, ana, (tx) => rows(tx, `select occurred_on::text as d from public.transactions where recurring_id = $1 order by 1`, [id]));
    expect(dates.map((r) => (r as { d: string }).d)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);

    const again = await asUser(db, ana, (tx) => one<{ n: number }>(tx, `select public.materialize_recurring($1, '2026-04-30') as n`, [org]));
    expect(again.n).toBe(0);

    await asUser(db, ana, (tx) => tx.query(`delete from public.transactions where recurring_id = $1 and occurred_on = '2026-02-28'`, [id]));
    const afterDelete = await asUser(db, ana, (tx) => one<{ n: number }>(tx, `select public.materialize_recurring($1, '2026-05-31') as n`, [org]));
    expect(afterDelete.n).toBe(1); // só maio; fevereiro continua apagado
  });

  it("o leitor não gera movimentos (o RLS esconde-lhe as recorrências a atualizar)", async () => {
    const before = (await db.query(`select id from public.transactions where organization_id = $1`, [org])).rows.length;
    const r = await asUser(db, leo, (tx) => one<{ n: number }>(tx, `select public.materialize_recurring($1, '2026-12-31') as n`, [org]));
    expect(r.n).toBe(0);
    expect((await db.query(`select id from public.transactions where organization_id = $1`, [org])).rows.length).toBe(before);
  });
});

describe("orçamentos e objetivos", () => {
  it("orçamento só para categorias de despesa, um por categoria e mês", async () => {
    const materials = await systemCategory("materials");
    const sales = await systemCategory("sales");
    await asUser(db, ana, (tx) => tx.query(`insert into public.budgets (organization_id, category_id, period_start, amount_minor, currency_code) values ($1, $2, '2026-11-01', 100000, 'EUR')`, [org, materials]));
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.budgets (organization_id, category_id, period_start, amount_minor, currency_code) values ($1, $2, '2026-11-01', 100, 'EUR')`, [org, materials])),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.budgets (organization_id, category_id, period_start, amount_minor, currency_code) values ($1, $2, '2026-11-01', 100, 'EUR')`, [org, sales])),
    ).rejects.toThrow(/category_invalid/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.budgets (organization_id, category_id, period_start, amount_minor, currency_code) values ($1, $2, '2026-11-15', 100, 'EUR')`, [org, materials])),
    ).rejects.toThrow();
  });

  it("objetivos pessoais são privados", async () => {
    await asUser(db, ana, (tx) => tx.query(`insert into public.savings_goals (owner_user_id, name, target_minor, currency_code) values ($1, 'Férias', 200000, 'EUR')`, [ana]));
    expect((await asUser(db, leo, (tx) => rows(tx, `select id from public.savings_goals`))).length).toBe(0);
    expect((await asUser(db, ana, (tx) => rows(tx, `select id from public.savings_goals`))).length).toBe(1);
  });
});
