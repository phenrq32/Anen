import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária da organização e com dados pessoais
let leo: string; // leitor: finance.read e business.read
let eva: string; // funcionária: só business.*
let rui: string; // outra organização
let org: string;
let account: string;
let supplier: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;
const generate = async (today: string, user: string | null = null) =>
  Number((await db.query<{ n: number }>(`select private.generate_notifications($1::date, $2::uuid) as n`, [today, user])).rows[0]!.n);
const kinds = (user: string) =>
  asUser(db, user, async (tx) => (await rows(tx, `select kind, organization_id from public.notifications order by kind, created_at`)) as { kind: string; organization_id: string | null }[]);

async function invite(email: string, role: string, user: string) {
  const token = await asUser(db, ana, async (tx) => {
    const r = await id(tx, `select id from public.roles where key = $1 and organization_id is null`, [role]);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [org, email, r])).token;
  });
  await asUser(db, user, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
}

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@notif.pt");
  leo = await createUser(db, "leo@notif.pt");
  eva = await createUser(db, "eva@notif.pt");
  rui = await createUser(db, "rui@notif.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Loja Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await invite("leo@notif.pt", "viewer", leo);
  await invite("eva@notif.pt", "employee", eva);
  [account, supplier] = await asUser(db, ana, async (tx) => [
    await id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Moagem') returning id`, [org]),
  ]);
  await asUser(db, ana, async (tx) => {
    // Organização: uma despesa vencida, uma a vencer daqui a 2 dias e outra daqui a 10.
    for (const [desc, due] of [["Renda", "2026-11-10"], ["Luz", "2026-11-23"], ["Água", "2026-12-01"]]) {
      await tx.query(
        `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, due_on, settled_minor) values ($1, $2, 'expense', 5000, 'EUR', '2026-11-01', $3, $4, 0)`,
        [org, account, desc, due],
      );
    }
    // Dados pessoais da Ana: um recebimento vencido.
    const personal = await id(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Pessoal', 'cash', 'EUR') returning id`, [ana]);
    await tx.query(
      `insert into public.transactions (owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on, description, due_on, settled_minor) values ($1, $2, 'income', 2000, 'EUR', '2026-11-01', 'Empréstimo ao Rui', '2026-11-15', 500)`,
      [ana, personal],
    );
  });
});

describe("geração", () => {
  it("vencidos e a vencer para quem tem finanças; nada para quem só tem negócio nem para outra organização", async () => {
    expect(await generate("2026-11-21")).toBeGreaterThan(0);
    expect((await kinds(ana)).map((k) => `${k.kind}:${k.organization_id ? "org" : "pessoal"}`)).toEqual([
      "payment_due_soon:org",
      "payment_overdue:org",
      "payment_overdue:pessoal",
    ]);
    expect((await kinds(leo)).map((k) => k.kind)).toEqual(["payment_due_soon", "payment_overdue"]);
    expect(await kinds(eva)).toEqual([]);
    expect(await kinds(rui)).toEqual([]);
    const data = await asUser(db, ana, (tx) => one<{ data: Record<string, unknown>; link: string }>(tx, `select data, link from public.notifications where kind = 'payment_overdue' and organization_id is null`));
    expect(data).toEqual({
      data: { description: "Empréstimo ao Rui", direction: "income", remaining_minor: 1500, currency: "EUR", due_on: "2026-11-15" },
      link: "/financas/em-aberto",
    });
  });

  it("não repete ao correr de novo", async () => {
    expect(await generate("2026-11-21")).toBe(0);
    expect(await kinds(ana)).toHaveLength(3);
  });

  it("respeita as preferências: tipos desligados e antecedência", async () => {
    await asUser(db, leo, (tx) =>
      tx.query(`insert into public.notification_settings (user_id, disabled_kinds, due_soon_days) values ($1, '{payment_overdue}', 15)`, [leo]),
    );
    await asUser(db, leo, (tx) => tx.query(`delete from public.notifications`));
    await generate("2026-11-21");
    // Sem vencidos; com 15 dias de antecedência, a Luz e a Água.
    expect((await kinds(leo)).map((k) => k.kind)).toEqual(["payment_due_soon", "payment_due_soon"]);
    await expect(
      asUser(db, leo, (tx) => tx.query(`update public.notification_settings set disabled_kinds = '{spam}' where user_id = $1`, [leo])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.notification_settings (user_id) values ($1)`, [leo])),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.notification_settings`))).toHaveLength(0);
  });

  it("stock abaixo do mínimo: uma vez por episódio; encomenda atrasada", async () => {
    const item = await asUser(db, eva, (tx) =>
      id(tx, `insert into public.stock_items (organization_id, name, unit, currency_code, min_quantity) values ($1, 'Farinha', 'kg', 'EUR', 10) returning id`, [org]),
    );
    const move = (kind: string, q: number, cost: number | null) =>
      asUser(db, eva, (tx) => tx.query(`insert into public.stock_movements (organization_id, item_id, kind, quantity, unit_cost_minor) values ($1, $2, $3, $4, $5)`, [org, item, kind, q, cost]));
    await move("in", 5, 100);
    await generate("2026-11-21");
    await generate("2026-11-21");
    const stock = async () => (await kinds(eva)).filter((k) => k.kind === "stock_below_minimum").length;
    expect(await stock()).toBe(1);
    await move("in", 10, 100); // 15: acima do mínimo
    await generate("2026-11-21");
    expect(await stock()).toBe(1);
    await move("out", 8, null); // 7: abaixo outra vez
    await generate("2026-11-21");
    expect(await stock()).toBe(2);

    const order = await asUser(db, eva, async (tx) => {
      const o = await id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code, expected_on) values ($1, $2, 'EUR', '2026-11-18') returning id`, [org, supplier]);
      await tx.query(`update public.purchase_orders set status = 'ordered', ordered_on = '2026-11-15' where id = $1`, [o]);
      return o;
    });
    await generate("2026-11-21");
    const late = await asUser(db, eva, (tx) => rows(tx, `select link, data->>'supplier' as supplier from public.notifications where kind = 'purchase_late'`));
    expect(late).toEqual([{ link: `/compras/${order}`, supplier: "Moagem" }]);
    // O leitor (business.read) também recebe; a outra organização não.
    expect((await kinds(leo)).some((k) => k.kind === "purchase_late")).toBe(true);
    expect(await kinds(rui)).toEqual([]);
  });

  it("a atualização a pedido só gera para a própria pessoa", async () => {
    await asUser(db, ana, (tx) => tx.query(`delete from public.notifications`));
    await asUser(db, leo, (tx) => tx.query(`delete from public.notifications`));
    const n = await asUser(db, ana, (tx) => one<{ n: number }>(tx, `select public.refresh_my_notifications() as n`));
    expect(n.n).toBeGreaterThan(0);
    expect((await kinds(ana)).length).toBeGreaterThan(0);
    expect(await kinds(leo)).toEqual([]);
    await expect(asUser(db, null, (tx) => tx.query(`select public.refresh_my_notifications()`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`select private.generate_notifications()`))).rejects.toThrow(/permission denied/);
  });
});

describe("acesso", () => {
  it("cada pessoa lê e marca como lidas só as suas; não cria nem altera o conteúdo", async () => {
    const mine = await asUser(db, ana, (tx) => one<{ id: string }>(tx, `select id from public.notifications limit 1`));
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.notifications where id = $1`, [mine.id]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `update public.notifications set read_at = now() where id = $1 returning id`, [mine.id]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `delete from public.notifications where id = $1 returning id`, [mine.id]))).toHaveLength(0);
    await asUser(db, ana, (tx) => tx.query(`update public.notifications set read_at = now() where id = $1`, [mine.id]));
    await expect(asUser(db, ana, (tx) => tx.query(`update public.notifications set data = '{}' where id = $1`, [mine.id]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.notifications (user_id, kind, dedupe_key) values ($1, 'market_alert', 'x')`, [ana])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.notifications`))).rejects.toThrow(/permission denied/);
  });

  it("quem deixa a organização (ou perde a permissão) deixa de ver as notificações dela", async () => {
    await generate("2026-11-21");
    expect((await kinds(leo)).some((k) => k.organization_id === org)).toBe(true);
    const member = (await db.query<{ id: string }>(`select id from public.organization_members where user_id = $1`, [leo])).rows[0]!.id;
    const viewer = (await db.query<{ id: string }>(`select id from public.roles where key = 'viewer' and organization_id is null`)).rows[0]!.id;
    await asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'suspended')`, [member, viewer]));
    expect((await kinds(leo)).filter((k) => k.organization_id === org)).toEqual([]);
  });
});

describe("tarefa diária", () => {
  it("regista a execução e limpa as antigas", async () => {
    await db.query(`update public.notifications set read_at = now() - interval '100 days' where user_id = $1`, [ana]);
    await db.query(`select private.run_notification_jobs()`);
    const run = (await db.query<{ status: string; details: { deleted: number } }>(`select status, details from public.job_runs where job = 'notifications' order by id desc limit 1`)).rows[0]!;
    expect(run.status).toBe("success");
    expect(run.details.deleted).toBeGreaterThan(0);
  });
});

describe("relatório financeiro", () => {
  it("faturado e liquidado por dimensão, só do âmbito pedido", async () => {
    const report = await asUser(db, ana, (tx) =>
      rows(tx, `select dimension, key, currency_code, income_total, income_settled, expense_total, expense_settled, count from public.finance_report($1, '2026-11-01', '2026-11-30') order by dimension, key nulls first`, [org]),
    );
    const total = report.find((r) => (r as { dimension: string }).dimension === "total");
    expect(total).toMatchObject({ currency_code: "EUR", income_total: 0, expense_total: 15000, expense_settled: 0, count: 3 });
    expect(report.filter((r) => (r as { dimension: string }).dimension === "category")).toHaveLength(1);
    const personal = await asUser(db, ana, (tx) => rows(tx, `select dimension, income_total, income_settled from public.finance_report(null, '2026-11-01', '2026-11-30') where dimension = 'total'`));
    expect(personal).toEqual([{ dimension: "total", income_total: 2000, income_settled: 500 }]);
    // Fora do período, outra organização, quem só tem negócio e anónimos: nada.
    expect(await asUser(db, ana, (tx) => rows(tx, `select * from public.finance_report($1, '2026-10-01', '2026-10-31')`, [org]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.finance_report($1, '2026-11-01', '2026-11-30')`, [org]))).toHaveLength(0);
    expect(await asUser(db, eva, (tx) => rows(tx, `select * from public.finance_report($1, '2026-11-01', '2026-11-30')`, [org]))).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.finance_report(null, '2026-11-01', '2026-11-30')`))).rejects.toThrow(/permission denied/);
  });
});
