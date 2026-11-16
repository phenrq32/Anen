import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária da organização
let leo: string; // leitor na organização
let ca: string; // contabilista na organização
let rui: string; // sem relação
let org: string;
let otherOrg: string; // organização do Rui
let account: string;
let accountBrl: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@biz.pt");
  leo = await createUser(db, "leo@biz.pt");
  ca = await createUser(db, "ca@biz.pt");
  rui = await createUser(db, "rui@biz.pt");
  org = await asUser(db, ana, async (tx) =>
    (await one<{ id: string }>(tx, `select public.create_organization('business', 'Obras Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id,
  );
  otherOrg = await asUser(db, rui, async (tx) =>
    (await one<{ id: string }>(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id,
  );
  for (const [email, role, user] of [["leo@biz.pt", "viewer", leo], ["ca@biz.pt", "accountant", ca]] as const) {
    const token = await asUser(db, ana, async (tx) => {
      const r = (await one<{ id: string }>(tx, `select id from public.roles where key = $1 and organization_id is null`, [role])).id;
      return (await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [org, email, r])).token;
    });
    await asUser(db, user, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  }
  [account, accountBrl] = await asUser(db, ana, async (tx) => [
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code, opening_balance_minor) values ($1, 'Banco', 'checking', 'EUR', 100000) returning id`, [org])).id,
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco BR', 'checking', 'BRL') returning id`, [org])).id,
  ]);
});

describe("contactos, centros de custo e projetos: acessos", () => {
  let supplier: string;

  it("a proprietária cria um fornecedor; o leitor e a contabilista leem mas não escrevem", async () => {
    supplier = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.contacts (organization_id, kind, name, tax_id) values ($1, 'supplier', 'Materiais SA', '500000000') returning id`, [org])).id,
    );
    for (const user of [leo, ca]) {
      expect(await asUser(db, user, (tx) => rows(tx, `select id from public.contacts where id = $1`, [supplier]))).toHaveLength(1);
      await expect(
        asUser(db, user, (tx) => tx.query(`insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'X')`, [org])),
      ).rejects.toThrow(/row-level security/);
      const updated = await asUser(db, user, (tx) => rows(tx, `update public.contacts set name = 'Y' where id = $1 returning id`, [supplier]));
      expect(updated).toHaveLength(0);
    }
  });

  it("outra organização e anónimos não veem nem alteram", async () => {
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.contacts`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `delete from public.contacts where id = $1 returning id`, [supplier]))).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.contacts`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.projects`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.cost_centers`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.projects (organization_id, name, currency_code) values ($1, 'P', 'EUR')`, [org])),
    ).rejects.toThrow(/row-level security/);
  });

  it("dados pessoais só do próprio", async () => {
    const own = await asUser(db, rui, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.contacts (owner_user_id, kind, name) values ($1, 'client', 'Cliente pessoal') returning id`, [rui])).id,
    );
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.contacts where id = $1`, [own]))).toHaveLength(0);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.cost_centers (owner_user_id, name) values ($1, 'CC')`, [rui])),
    ).rejects.toThrow(/row-level security/);
  });

  it("o âmbito e o autor não mudam", async () => {
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.contacts set organization_id = $1 where id = $2`, [otherOrg, supplier])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("movimentos ligados a contacto, projeto e centro de custo", () => {
  let project: string;
  let supplier: string;
  let cc: string;

  beforeAll(async () => {
    [project, supplier, cc] = await asUser(db, ana, async (tx) => [
      (await one<{ id: string }>(tx, `insert into public.projects (organization_id, name, currency_code, planned_cost_minor, planned_revenue_minor) values ($1, 'Remodelação A', 'EUR', 30000, 50000) returning id`, [org])).id,
      (await one<{ id: string }>(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Leroy') returning id`, [org])).id,
      (await one<{ id: string }>(tx, `insert into public.cost_centers (organization_id, name) values ($1, 'Obra') returning id`, [org])).id,
    ]);
  });

  it("liga uma despesa e separa imposto; o estado de pagamento é derivado", async () => {
    const tx = await asUser(db, ana, (t) =>
      one<{ payment_status: string; settled_minor: number }>(
        t,
        `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description,
                                          contact_id, project_id, cost_center_id, cost_kind, net_minor, tax_minor, due_on, settled_minor)
         values ($1, $2, 'expense', 35000, 'EUR', '2026-11-10', 'Materiais', $3, $4, $5, 'material', 28455, 6545, '2026-12-10', 0)
         returning payment_status, settled_minor`,
        [org, account, supplier, project, cc],
      ),
    );
    expect(tx.payment_status).toBe("pending");
    expect(Number(tx.settled_minor)).toBe(0);
  });

  it("sem indicação, um movimento fica pago; pagamento parcial é derivado", async () => {
    const r = await asUser(db, ana, async (t) => {
      const id = (await one<{ id: string }>(t, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, project_id) values ($1, $2, 'income', 20000, 'EUR', '2026-11-11', 'Adiantamento', $3) returning id`, [org, account, project])).id;
      const before = await one<{ payment_status: string }>(t, `select payment_status from public.transactions where id = $1`, [id]);
      const after = await one<{ payment_status: string }>(t, `update public.transactions set settled_minor = 5000 where id = $1 returning payment_status`, [id]);
      // Pago e valor alterado sem indicar liquidação: continua pago
      const paidId = (await one<{ id: string }>(t, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 1000, 'EUR', '2026-11-11', 'Café') returning id`, [org, account])).id;
      const changed = await one<{ settled_minor: number }>(t, `update public.transactions set amount_minor = 1500 where id = $1 returning settled_minor`, [paidId]);
      return { before: before.payment_status, after: after.payment_status, changed: Number(changed.settled_minor) };
    });
    expect(r).toEqual({ before: "paid", after: "partial", changed: 1500 });
  });

  it("o saldo e o resumo mensal contam só o valor liquidado", async () => {
    const balance = await asUser(db, ana, (t) => one<{ balance_minor: number }>(t, `select balance_minor from public.account_balances($1) where account_id = $2`, [org, account]));
    // 100000 + 5000 (recebido do adiantamento) - 0 (materiais pendentes) - 1500 (café)
    expect(Number(balance.balance_minor)).toBe(103500);
    const monthly = await asUser(db, ana, (t) => one<{ income: number; expense: number }>(t, `select income, expense from public.finance_monthly($1, '2026-11-01', '2026-11-30')`, [org]));
    expect([Number(monthly.income), Number(monthly.expense)]).toEqual([5000, 1500]);
  });

  it("rejeita imposto incoerente, liquidação acima do valor e moeda diferente da do projeto", async () => {
    await expect(
      asUser(db, ana, (t) => t.query(`insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, net_minor, tax_minor) values ($1, $2, 'expense', 1000, 'EUR', '2026-11-12', 'x', 800, 100)`, [org, account])),
    ).rejects.toThrow(/transactions_tax_split/);
    await expect(
      asUser(db, ana, (t) => t.query(`insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, project_id) values ($1, $2, 'expense', 1000, 'BRL', '2026-11-12', 'x', $3)`, [org, accountBrl, project])),
    ).rejects.toThrow(/project_currency_mismatch/);
    const clamped = await asUser(db, ana, (t) => one<{ settled_minor: number }>(t, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, settled_minor) values ($1, $2, 'expense', 1000, 'EUR', '2026-11-12', 'x', 5000) returning settled_minor`, [org, account]));
    expect(Number(clamped.settled_minor)).toBe(1000);
  });

  it("não liga a contactos, projetos ou centros de custo de outro âmbito", async () => {
    const foreign = await asUser(db, rui, async (t) => ({
      contact: (await one<{ id: string }>(t, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Alheio') returning id`, [otherOrg])).id,
      project: (await one<{ id: string }>(t, `insert into public.projects (organization_id, name, currency_code) values ($1, 'Alheio', 'EUR') returning id`, [otherOrg])).id,
      cc: (await one<{ id: string }>(t, `insert into public.cost_centers (organization_id, name) values ($1, 'Alheio') returning id`, [otherOrg])).id,
    }));
    const base = `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description`;
    await expect(asUser(db, ana, (t) => t.query(`${base}, contact_id) values ($1, $2, 'expense', 100, 'EUR', '2026-11-12', 'x', $3)`, [org, account, foreign.contact]))).rejects.toThrow(/contact_invalid/);
    await expect(asUser(db, ana, (t) => t.query(`${base}, project_id) values ($1, $2, 'expense', 100, 'EUR', '2026-11-12', 'x', $3)`, [org, account, foreign.project]))).rejects.toThrow(/project_invalid/);
    await expect(asUser(db, ana, (t) => t.query(`${base}, cost_center_id) values ($1, $2, 'expense', 100, 'EUR', '2026-11-12', 'x', $3)`, [org, account, foreign.cc]))).rejects.toThrow(/cost_center_invalid/);
    await expect(
      asUser(db, ana, (t) => t.query(`insert into public.projects (organization_id, name, currency_code, client_contact_id) values ($1, 'P', 'EUR', $2)`, [org, foreign.contact])),
    ).rejects.toThrow(/contact_invalid/);
  });

  it("a moeda de um projeto com movimentos fica bloqueada", async () => {
    await expect(asUser(db, ana, (t) => t.query(`update public.projects set name = 'Remodelação A1' where id = $1`, [project]))).resolves.toBeTruthy();
    await expect(
      db.query(`update public.projects set currency_code = 'BRL' where id = $1`, [project]),
    ).rejects.toThrow(/project_currency_locked/);
  });
});

describe("projeto a partir de um orçamento aceite", () => {
  let quote: string;

  beforeAll(async () => {
    quote = await asUser(db, ana, async (t) => {
      const id = (await one<{ id: string }>(t, `insert into public.quotes (organization_id, title, currency_code, number, client_name, client_email, total_cost_minor, price_before_tax_minor) values ($1, 'Cozinha Silva', 'EUR', 'x', 'Maria Silva', 'maria@x.pt', 30000, 40000) returning id`, [org])).id;
      await t.query(`select public.snapshot_quote($1)`, [id]);
      return id;
    });
  });

  it("recusa orçamentos que não estão aceites", async () => {
    await expect(asUser(db, ana, (t) => t.query(`select public.create_project_from_quote($1)`, [quote]))).rejects.toThrow(/quote_not_accepted/);
  });

  it("cria o projeto com os valores previstos e o cliente; é idempotente", async () => {
    await asUser(db, ana, async (t) => {
      await t.query(`update public.quotes set status = 'sent' where id = $1`, [quote]);
      await t.query(`update public.quotes set status = 'accepted' where id = $1`, [quote]);
    });
    const first = await asUser(db, ana, (t) => one<{ id: string }>(t, `select public.create_project_from_quote($1) as id`, [quote]));
    const second = await asUser(db, ana, (t) => one<{ id: string }>(t, `select public.create_project_from_quote($1) as id`, [quote]));
    expect(second.id).toBe(first.id);
    const project = await asUser(db, ana, (t) =>
      one<{ planned_cost_minor: number; planned_revenue_minor: number; name: string; client: string }>(
        t,
        `select p.planned_cost_minor, p.planned_revenue_minor, p.name, c.name as client from public.projects p join public.contacts c on c.id = p.client_contact_id where p.id = $1`,
        [first.id],
      ),
    );
    expect([Number(project.planned_cost_minor), Number(project.planned_revenue_minor), project.name, project.client]).toEqual([30000, 40000, "Cozinha Silva", "Maria Silva"]);
  });

  it("um leitor não cria projetos; outra organização não vê o orçamento", async () => {
    await expect(asUser(db, rui, (t) => t.query(`select public.create_project_from_quote($1)`, [quote]))).rejects.toThrow(/forbidden/);
  });
});
