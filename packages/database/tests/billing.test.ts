import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Assinaturas pagas (migration 2500).
let db: PGlite;
let ana: string;
let rui: string;
let leo: string;
let org: string;
let secret: string;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
type Order = { id: string; order_nsu: string; amount_minor: number; currency_code: string };
const order = (user: string, plan: string, months: number, currency = "BRL", provider = "infinitepay", scope: string | null = null) =>
  asUser(db, user, (tx) => one<Order>(tx, `select * from public.create_billing_order($1, $2, $3, $4, $5)`, [scope, plan, months, currency, provider]));
const confirm = (nsu: string, paid: number) =>
  asUser(db, null, (tx) => one<{ r: string }>(tx, `select public.billing_confirm($1, $2, $3, 'tx-1') as r`, [secret, nsu, paid]));
const plan = (user: string) =>
  db.query<{ key: string; end: string | null }>(
    `select s.plan_key as key, s.current_period_end::text as end from public.subscriptions s where s.owner_user_id = $1 and s.status = 'active'`,
    [user],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@planos.pt");
  rui = await createUser(db, "rui@planos.pt");
  leo = await createUser(db, "leo@planos.pt");
  org = await asUser(db, ana, async (tx) => (await one<{ id: string }>(tx, `select public.create_organization('business', 'Planos Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  const token = await asUser(db, ana, async (tx) => {
    const viewer = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@planos.pt', $2)`, [org, viewer])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  secret = (await db.query<{ value: string }>(`select value from private.app_secrets where key = 'billing'`)).rows[0]!.value;
});

describe("preços", () => {
  it("lidos por qualquer pessoa autenticada; ninguém os altera", async () => {
    const rows = await asUser(db, rui, (tx) => tx.query(`select plan_key, currency_code, months, price_minor from public.plan_prices order by currency_code, plan_key, months`));
    expect(rows.rows).toContainEqual({ plan_key: "max", currency_code: "BRL", months: 12, price_minor: 29900 });
    await expect(asUser(db, rui, (tx) => tx.query(`update public.plan_prices set price_minor = 1`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select 1 from public.plan_prices`))).rejects.toThrow(/permission denied/);
  });
});

describe("pedidos", () => {
  it("o valor vem da tabela de preços; plano, período e moeda inválidos são recusados", async () => {
    const o = await order(ana, "pro", 1);
    expect([o.amount_minor, o.currency_code]).toEqual([1490, "BRL"]);
    expect(o.order_nsu).toMatch(/^anen-[0-9A-F]{12}$/);
    await expect(order(ana, "free", 1)).rejects.toThrow(/plan_invalid/);
    await expect(order(ana, "pro", 6)).rejects.toThrow(/plan_invalid/);
    await expect(order(ana, "pro", 1, "EUR", "infinitepay")).rejects.toThrow(/plan_invalid/);
    expect((await order(ana, "max", 12, "EUR", "bank_transfer")).amount_minor).toBe(7990);
  });

  it("organização: só quem pode alterar a organização compra; leitor e outros não", async () => {
    expect((await order(ana, "max", 1, "BRL", "infinitepay", org)).amount_minor).toBe(2990);
    await expect(order(leo, "max", 1, "BRL", "infinitepay", org)).rejects.toThrow(/forbidden/);
    await expect(order(rui, "max", 1, "BRL", "infinitepay", org)).rejects.toThrow(/forbidden/);
  });

  it("cada pessoa vê só os seus pedidos (e os da organização que gere)", async () => {
    expect((await asUser(db, rui, (tx) => tx.query(`select id from public.billing_orders`))).rows).toHaveLength(0);
    expect((await asUser(db, leo, (tx) => tx.query(`select id from public.billing_orders`))).rows).toHaveLength(0);
    expect((await asUser(db, ana, (tx) => tx.query(`select id from public.billing_orders`))).rows.length).toBeGreaterThanOrEqual(3);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.billing_orders set status = 'paid'`))).rejects.toThrow(/permission denied/);
  });
});

describe("confirmação e período", () => {
  it("só com o segredo e o valor completo; ativa o plano por um mês; repetir não duplica", async () => {
    const o = await order(rui, "pro", 1);
    await expect(asUser(db, null, (tx) => tx.query(`select public.billing_confirm('x', $1, 1490, 't')`, [o.order_nsu]))).rejects.toThrow(/forbidden/);
    expect((await confirm(o.order_nsu, 1000)).r).toBe("rejected");
    expect((await plan(rui)).rows).toHaveLength(0);
    expect((await confirm(o.order_nsu, 1490)).r).toBe("paid");
    expect((await confirm(o.order_nsu, 1490)).r).toBe("already_paid");
    const p = (await plan(rui)).rows;
    expect(p).toHaveLength(1);
    expect(p[0]!.key).toBe("pro");
    const days = (Date.parse(p[0]!.end!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect((await confirm("anen-NAOEXISTE", 1490)).r).toBe("not_found");
  });

  it("renovar o mesmo plano soma ao fim do período; mudar para o Max começa hoje", async () => {
    const before = Date.parse((await plan(rui)).rows[0]!.end!);
    const renew = await order(rui, "pro", 12);
    await confirm(renew.order_nsu, 14900);
    const after = Date.parse((await plan(rui)).rows[0]!.end!);
    expect((after - before) / 86_400_000).toBeGreaterThan(360);
    const up = await order(rui, "max", 1);
    await confirm(up.order_nsu, 2990);
    const p = (await plan(rui)).rows;
    expect(p.map((x) => x.key)).toEqual(["max"]);
    expect((Date.parse(p[0]!.end!) - Date.now()) / 86_400_000).toBeLessThan(32);
  });

  it("transferência por IBAN: só um administrador da plataforma confirma", async () => {
    const o = await order(leo, "pro", 1, "EUR", "bank_transfer");
    await expect(asUser(db, leo, (tx) => tx.query(`select public.admin_confirm_billing($1)`, [o.id]))).rejects.toThrow(/forbidden/);
    await db.query(`insert into public.admin_users (user_id, role) values ($1, 'finance')`, [ana]);
    await asUser(db, ana, (tx) => tx.query(`select public.admin_confirm_billing($1)`, [o.id]));
    expect((await plan(leo)).rows.map((x) => x.key)).toEqual(["pro"]);
  });
});
