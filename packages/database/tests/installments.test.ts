import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { installmentSchedule, type InstallmentInput } from "@anen/financial-engine";
import { asUser, createTestDatabase, createUser } from "../src/index";

/** Dual Workspace · Fase 5 (§5.6): parcelas mensais com fim, nos dois workspaces, com acessos cruzados. */
let db: PGlite;
let ana: string; // proprietária da empresa
let leo: string; // leitor na empresa
let rui: string; // sem relação
let org: string;
let orgAccount: string;
let anaAccount: string;
let category: string;

type Row = Record<string, unknown>;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<Row>(sql, params)).rows;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;

const CREATE = `select public.create_installment_plan(
  p_org => $1, p_kind => $2, p_description => $3, p_account_id => $4, p_due_day => $5, p_start_on => $6,
  p_total_minor => $7, p_per_minor => $8, p_count => $9, p_end_on => $10, p_category_id => $11) as id`;

const parcels = (t: Transaction, plan: string) =>
  rows(
    t,
    `select installment_number as n, due_on::text as due, occurred_on::text as occurred, amount_minor::bigint as amount,
            settled_minor::bigint as settled, payment_status as status, kind
     from public.transactions where installment_plan_id = $1 order by installment_number`,
    [plan],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@parcelas.pt");
  leo = await createUser(db, "leo@parcelas.pt");
  rui = await createUser(db, "rui@parcelas.pt");
  org = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, `select public.create_organization('business', 'Parcelas Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  const token = await asUser(db, ana, async (t) => {
    const r = (await one<{ id: string }>(t, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(t, `select token from public.invite_member($1, 'leo@parcelas.pt', $2)`, [org, r])).token;
  });
  await asUser(db, leo, (t) => t.query(`select public.accept_invitation($1)`, [token]));
  [orgAccount, anaAccount] = await asUser(db, ana, async (t) => [
    (await one<{ id: string }>(t, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org])).id,
    (await one<{ id: string }>(t, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Pessoal', 'checking', 'EUR') returning id`, [ana])).id,
  ]);
  category = (await db.query<{ id: string }>(`select id from public.transaction_categories where is_system and kind = 'expense' order by id limit 1`)).rows[0]!.id;
});

describe("criar parcelas", () => {
  it("pessoal: 12 parcelas do valor total, no dia 31, com fevereiro e o acerto de cêntimos na última", async () => {
    const plan = await asUser(db, ana, async (t) =>
      (await one<{ id: string }>(t, CREATE, [null, "expense", "Telemóvel em prestações", anaAccount, 31, "2027-01-05", 100000, null, 12, null, category])).id,
    );
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list).toHaveLength(12);
    expect(list.slice(0, 3).map((p) => p["due"])).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(list.map((p) => Number(p["amount"])).slice(-2)).toEqual([8333, 8337]);
    expect(list.reduce((a, p) => a + Number(p["amount"]), 0)).toBe(100000);
    // Previstas, não pagas; a data do movimento é a do vencimento (fica no mês certo)
    expect(new Set(list.map((p) => p["status"]))).toEqual(new Set(["pending"]));
    expect(list.every((p) => p["due"] === p["occurred"])).toBe(true);
    const meta = await asUser(db, ana, (t) => one<Row>(t, `select installment_count, total_minor::bigint as total, first_due_on::text as f, last_due_on::text as l from public.installment_plans where id = $1`, [plan]));
    expect(meta).toMatchObject({ installment_count: 12, f: "2027-01-31", l: "2027-12-31" });
    expect(Number(meta["total"])).toBe(100000);
  });

  it("empresa: receita por parcela até uma data de fim, sem nunca a ultrapassar", async () => {
    const plan = await asUser(db, ana, async (t) =>
      (await one<{ id: string }>(t, CREATE, [org, "income", "Cliente em prestações", orgAccount, 15, "2026-11-23", null, 25000, null, "2027-06-14", null])).id,
    );
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list.map((p) => p["due"])).toEqual(["2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15", "2027-04-15", "2027-05-15"]);
    expect(list.every((p) => Number(p["amount"]) === 25000 && p["kind"] === "income")).toBe(true);
  });

  it("o saldo da conta não muda: as parcelas futuras não contam como pagas", async () => {
    const b = await asUser(db, ana, (t) => one<{ balance_minor: number }>(t, `select balance_minor from public.account_balances(null) where account_id = $1`, [anaAccount]));
    expect(Number(b.balance_minor)).toBe(0);
  });

  it("recusa entradas inválidas com chaves de erro", async () => {
    const call = (args: unknown[]) => asUser(db, ana, (t) => t.query(CREATE, args));
    await expect(call([null, "expense", "x", anaAccount, 10, "2027-01-01", 1000, 100, 3, null, null])).rejects.toThrow(/installment_invalid/);
    await expect(call([null, "expense", "x", anaAccount, 10, "2027-01-01", 1000, null, 3, "2027-12-01", null])).rejects.toThrow(/installment_invalid/);
    await expect(call([null, "expense", "x", anaAccount, 32, "2027-01-01", 1000, null, 3, null, null])).rejects.toThrow(/installment_day_invalid/);
    await expect(call([null, "expense", "x", anaAccount, 10, "2027-01-01", 1000, null, 361, null, null])).rejects.toThrow(/installment_count_invalid/);
    await expect(call([null, "expense", "x", anaAccount, 10, "2027-01-01", 2, null, 3, null, null])).rejects.toThrow(/installment_amount_invalid/);
    await expect(call([null, "expense", "x", anaAccount, 10, "2027-01-01", 1000, null, null, "2026-12-31", null])).rejects.toThrow(/installment_count_invalid/);
    // Conta de outro workspace
    await expect(call([null, "expense", "x", orgAccount, 10, "2027-01-01", 1000, null, 3, null, null])).rejects.toThrow(/account_invalid/);
  });
});

describe("paridade com o motor (@anen/financial-engine)", () => {
  const cases: InstallmentInput[] = [
    { startOn: "2026-11-23", dueDay: 10, amount: { totalMinor: 120000n }, end: { count: 12 } },
    { startOn: "2027-12-01", dueDay: 31, amount: { perInstallmentMinor: 100n }, end: { count: 5 } },
    { startOn: "2026-01-31", dueDay: 30, amount: { totalMinor: 99999n }, end: { count: 7 } },
    { startOn: "2026-11-23", dueDay: 15, amount: { perInstallmentMinor: 2500n }, end: { endOn: "2027-06-15" } },
    { startOn: "2028-02-29", dueDay: 29, amount: { totalMinor: 1000n }, end: { endOn: "2029-03-01" } },
    { startOn: "2026-05-10", dueDay: 10, amount: { totalMinor: 1n }, end: { count: 1 } },
  ];
  for (const c of cases) {
    it(`${c.startOn}, dia ${c.dueDay}, ${JSON.stringify(c.end)}`, async () => {
      const expected = installmentSchedule(c);
      if (!expected.ok) throw new Error(expected.error);
      const plan = await asUser(db, ana, async (t) =>
        (
          await one<{ id: string }>(t, CREATE, [
            null,
            "expense",
            "Paridade",
            anaAccount,
            c.dueDay,
            c.startOn,
            "totalMinor" in c.amount ? c.amount.totalMinor.toString() : null,
            "perInstallmentMinor" in c.amount ? c.amount.perInstallmentMinor.toString() : null,
            "count" in c.end ? c.end.count : null,
            "endOn" in c.end ? c.end.endOn : null,
            null,
          ])
        ).id,
      );
      const list = await asUser(db, ana, (t) => parcels(t, plan));
      expect(list.map((p) => [Number(p["n"]), p["due"], BigInt(p["amount"] as number)])).toEqual(
        expected.installments.map((i) => [i.number, i.dueOn, i.amountMinor]),
      );
    });
  }
});

describe("pagar, alterar e cancelar", () => {
  let plan: string;

  beforeAll(async () => {
    plan = await asUser(db, ana, async (t) =>
      (await one<{ id: string }>(t, CREATE, [org, "expense", "Carrinha em leasing", orgAccount, 5, "2027-01-01", null, 30000, 6, null, null])).id,
    );
  });

  it("cada parcela marca-se como paga sozinha; as seguintes continuam previstas", async () => {
    await asUser(db, ana, (t) => t.query(`update public.transactions set settled_minor = amount_minor where installment_plan_id = $1 and installment_number = 1`, [plan]));
    await asUser(db, ana, (t) => t.query(`update public.transactions set settled_minor = 10000 where installment_plan_id = $1 and installment_number = 2`, [plan]));
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list.map((p) => p["status"])).toEqual(["paid", "partial", "pending", "pending", "pending", "pending"]);
  });

  it("alterar esta e as seguintes: muda valor e dia só nas que não têm nada pago", async () => {
    const n = await asUser(db, ana, (t) => one<{ n: number }>(t, `select public.update_installments_from($1, 2, 35000, 28) as n`, [plan]));
    expect(n.n).toBe(4); // a 2 está parcialmente paga e fica
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list.map((p) => Number(p["amount"]))).toEqual([30000, 30000, 35000, 35000, 35000, 35000]);
    expect(list.map((p) => p["due"])).toEqual(["2027-01-05", "2027-02-05", "2027-03-28", "2027-04-28", "2027-05-28", "2027-06-28"]);
    const total = await asUser(db, ana, (t) => one<{ total: number }>(t, `select total_minor::bigint as total from public.installment_plans where id = $1`, [plan]));
    expect(Number(total.total)).toBe(200000);
  });

  it("editar só uma parcela é uma edição normal do movimento", async () => {
    await asUser(db, ana, (t) => t.query(`update public.transactions set amount_minor = 36000 where installment_plan_id = $1 and installment_number = 4`, [plan]));
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list.map((p) => Number(p["amount"]))).toEqual([30000, 30000, 35000, 36000, 35000, 35000]);
  });

  it("cancelar as restantes apaga só as previstas a partir da escolhida; pagas e parciais ficam", async () => {
    const deleted = await asUser(db, ana, (t) => one<{ n: number }>(t, `select public.cancel_installments($1, 2) as n`, [plan]));
    expect(deleted.n).toBe(4);
    const list = await asUser(db, ana, (t) => parcels(t, plan));
    expect(list.map((p) => Number(p["n"]))).toEqual([1, 2]);
    const meta = await asUser(db, ana, (t) => one<Row>(t, `select cancelled_at is not null as cancelled, cancelled_from from public.installment_plans where id = $1`, [plan]));
    expect(meta).toEqual({ cancelled: true, cancelled_from: 2 });
    // Sem nada por liquidar: cancelar de novo não faz nada
    await asUser(db, ana, (t) => t.query(`update public.transactions set settled_minor = amount_minor where installment_plan_id = $1`, [plan]));
    expect((await asUser(db, ana, (t) => one<{ n: number }>(t, `select public.cancel_installments($1) as n`, [plan]))).n).toBe(0);
  });
});

describe("parcelas: acessos cruzados e regras", () => {
  let plan: string;
  let personalPlan: string;

  beforeAll(async () => {
    plan = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, CREATE, [org, "expense", "Máquina", orgAccount, 10, "2027-01-01", 60000, null, 6, null, null])).id);
    personalPlan = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, CREATE, [null, "expense", "Sofá", anaAccount, 10, "2027-01-01", 60000, null, 6, null, null])).id);
  });

  it("outra pessoa não vê, não cria, não altera nem cancela, mesmo com o id", async () => {
    for (const id of [plan, personalPlan]) {
      expect(await asUser(db, rui, (t) => rows(t, `select id from public.installment_plans where id = $1`, [id]))).toHaveLength(0);
      expect(await asUser(db, rui, (t) => rows(t, `select id from public.transactions where installment_plan_id = $1`, [id]))).toHaveLength(0);
      await expect(asUser(db, rui, (t) => t.query(`select public.cancel_installments($1)`, [id]))).rejects.toThrow(/installment_invalid/);
      await expect(asUser(db, rui, (t) => t.query(`select public.update_installments_from($1, 1, 1000)`, [id]))).rejects.toThrow(/installment_invalid/);
    }
    await expect(asUser(db, rui, (t) => t.query(CREATE, [org, "expense", "x", orgAccount, 10, "2027-01-01", 1000, null, 2, null, null]))).rejects.toThrow(/forbidden/);
  });

  it("os planos pessoais da proprietária não aparecem ao membro da empresa; o leitor vê os da empresa mas não altera", async () => {
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.installment_plans where id = $1`, [personalPlan]))).toHaveLength(0);
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.installment_plans where id = $1`, [plan]))).toHaveLength(1);
    await expect(asUser(db, leo, (t) => t.query(`select public.cancel_installments($1)`, [plan]))).rejects.toThrow(/installment_invalid/);
    await expect(asUser(db, leo, (t) => t.query(CREATE, [org, "expense", "x", orgAccount, 10, "2027-01-01", 1000, null, 2, null, null]))).rejects.toThrow(/forbidden/);
  });

  it("ninguém escreve diretamente nos planos nem liga movimentos a planos à mão", async () => {
    await expect(asUser(db, ana, (t) => t.query(`update public.installment_plans set total_minor = 1 where id = $1`, [plan]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (t) => t.query(`delete from public.installment_plans where id = $1`, [plan]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (t) =>
        t.query(
          `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, installment_plan_id, installment_number) values ($1, $2, 'expense', 100, 'EUR', '2027-01-01', 'falsa', $3, 99)`,
          [org, orgAccount, plan],
        ),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      asUser(db, ana, (t) => t.query(`update public.transactions set installment_number = 7 where installment_plan_id = $1 and installment_number = 1`, [plan])),
    ).rejects.toThrow(/permission denied|forbidden/);
  });

  it("anónimos não leem nem chamam as funções", async () => {
    await expect(asUser(db, null, (t) => t.query(`select id from public.installment_plans`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (t) => t.query(`select public.cancel_installments($1)`, [plan]))).rejects.toThrow(/permission denied/);
  });

  it("criar um plano fica na auditoria", async () => {
    const logs = await db.query<{ action: string }>(`select action from public.audit_logs where entity_type = 'installment_plans' and entity_id = $1`, [plan]);
    expect(logs.rows.map((r) => r.action)).toContain("insert");
  });
});
