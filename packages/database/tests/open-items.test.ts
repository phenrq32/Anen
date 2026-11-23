import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

/**
 * "A receber e a pagar": o mesmo fluxo que a página /financas/em-aberto usa
 * (criar pendente ou parcial, editar, liquidar, eliminar) nos âmbitos pessoal e
 * de organização, e acessos cruzados recusados.
 */
let db: PGlite;
let ana: string; // proprietária da organização
let leo: string; // leitor na organização
let rui: string; // sem relação
let org: string;
let orgAccount: string;
let anaAccount: string; // conta pessoal da Ana
let ruiAccount: string; // conta pessoal do Rui

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<Record<string, unknown>>(sql, params)).rows;

const OPEN = `select id, kind, payment_status, amount_minor - settled_minor as outstanding
  from public.transactions where payment_status in ('pending', 'partial')`;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@aberto.pt");
  leo = await createUser(db, "leo@aberto.pt");
  rui = await createUser(db, "rui@aberto.pt");
  org = await asUser(db, ana, async (tx) =>
    (await one<{ id: string }>(tx, `select public.create_organization('business', 'Aberto Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id,
  );
  const token = await asUser(db, ana, async (tx) => {
    const r = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@aberto.pt', $2)`, [org, r])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  orgAccount = await asUser(db, ana, async (tx) =>
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org])).id,
  );
  anaAccount = await asUser(db, ana, async (tx) =>
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Pessoal', 'checking', 'EUR') returning id`, [ana])).id,
  );
  ruiAccount = await asUser(db, rui, async (tx) =>
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Rui', 'checking', 'EUR') returning id`, [rui])).id,
  );
});

const insert = (scope: "organization_id" | "owner_user_id") =>
  `insert into public.transactions (${scope}, account_id, kind, amount_minor, currency_code, occurred_on, description, due_on, settled_minor)
   values ($1, $2, $3, $4, 'EUR', '2026-11-23', $5, $6, $7) returning id, payment_status`;

describe.each([
  { label: "organização", scope: "organization_id" as const, value: () => org, account: () => orgAccount },
  { label: "pessoal", scope: "owner_user_id" as const, value: () => ana, account: () => anaAccount },
])("a receber e a pagar ($label)", ({ scope, value, account }) => {
  let receivable: string;
  let payable: string;

  it("cria um valor a receber pendente e um a pagar parcial", async () => {
    const r = await asUser(db, ana, (t) =>
      one<{ id: string; payment_status: string }>(t, insert(scope), [value(), account(), "income", 123456, "Fatura 12", "2026-12-10", 0]),
    );
    const p = await asUser(db, ana, (t) =>
      one<{ id: string; payment_status: string }>(t, insert(scope), [value(), account(), "expense", 50000, "Renda", "2026-12-01", 20000]),
    );
    expect(r.payment_status).toBe("pending");
    expect(p.payment_status).toBe("partial");
    receivable = r.id;
    payable = p.id;
    const open = await asUser(db, ana, (t) => rows(t, `${OPEN} and ${scope} = $1 order by kind`, [value()]));
    expect(open.map((o) => [o["kind"], Number(o["outstanding"])])).toEqual([
      ["expense", 30000],
      ["income", 123456],
    ]);
  });

  it("o saldo da conta só conta o valor já liquidado", async () => {
    const balance = await asUser(db, ana, (t) =>
      one<{ balance_minor: number }>(t, `select balance_minor from public.account_balances($1) where account_id = $2`, [scope === "organization_id" ? org : null, account()]),
    );
    expect(Number(balance.balance_minor)).toBe(-20000);
  });

  it("editar o valor de um pendente mantém-no pendente", async () => {
    const edited = await asUser(db, ana, (t) =>
      one<{ payment_status: string; settled_minor: number }>(
        t,
        `update public.transactions set amount_minor = 130000, settled_minor = 0, due_on = '2026-12-15' where id = $1 returning payment_status, settled_minor`,
        [receivable],
      ),
    );
    expect(edited.payment_status).toBe("pending");
    expect(Number(edited.settled_minor)).toBe(0);
  });

  it("marcar como liquidado tira-o da lista", async () => {
    await asUser(db, ana, (t) => t.query(`update public.transactions set settled_minor = amount_minor where id = $1`, [payable]));
    const open = await asUser(db, ana, (t) => rows(t, `${OPEN} and ${scope} = $1`, [value()]));
    expect(open.map((o) => o["id"])).toEqual([receivable]);
  });

  it("eliminar um valor em aberto", async () => {
    const deleted = await asUser(db, ana, (t) => rows(t, `delete from public.transactions where id = $1 returning id`, [receivable]));
    expect(deleted).toHaveLength(1);
    expect(await asUser(db, ana, (t) => rows(t, `${OPEN} and ${scope} = $1`, [value()]))).toHaveLength(0);
  });
});

describe("a receber e a pagar: acessos cruzados", () => {
  let orgItem: string;
  let personalItem: string;

  beforeAll(async () => {
    orgItem = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, insert("organization_id"), [org, orgAccount, "income", 9900, "Cliente X", "2026-12-01", 0])).id);
    personalItem = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, insert("owner_user_id"), [ana, anaAccount, "expense", 4500, "Ginásio", "2026-12-05", 0])).id);
  });

  it("outra pessoa não vê, não liquida nem apaga, mesmo com o identificador", async () => {
    for (const id of [orgItem, personalItem]) {
      expect(await asUser(db, rui, (t) => rows(t, `select id from public.transactions where id = $1`, [id]))).toHaveLength(0);
      expect(await asUser(db, rui, (t) => rows(t, `update public.transactions set settled_minor = amount_minor where id = $1 returning id`, [id]))).toHaveLength(0);
      expect(await asUser(db, rui, (t) => rows(t, `delete from public.transactions where id = $1 returning id`, [id]))).toHaveLength(0);
    }
  });

  it("ninguém regista valores no âmbito de outro", async () => {
    await expect(
      asUser(db, rui, (t) => t.query(insert("organization_id"), [org, orgAccount, "income", 100, "x", null, 0])),
    ).rejects.toThrow(/row-level security|account_invalid/);
    await expect(
      asUser(db, rui, (t) => t.query(insert("owner_user_id"), [ana, anaAccount, "income", 100, "x", null, 0])),
    ).rejects.toThrow(/row-level security|account_invalid/);
    // Conta própria num âmbito alheio também é recusada
    await expect(
      asUser(db, rui, (t) => t.query(insert("organization_id"), [org, ruiAccount, "income", 100, "x", null, 0])),
    ).rejects.toThrow();
  });

  it("os dados pessoais da proprietária não aparecem a quem é membro da organização", async () => {
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.transactions where id = $1`, [personalItem]))).toHaveLength(0);
    expect(await asUser(db, leo, (t) => rows(t, `select id from public.transactions where id = $1`, [orgItem]))).toHaveLength(1);
  });

  it("o leitor vê mas não regista, liquida nem apaga", async () => {
    await expect(
      asUser(db, leo, (t) => t.query(insert("organization_id"), [org, orgAccount, "income", 100, "x", null, 0])),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (t) => rows(t, `update public.transactions set settled_minor = amount_minor where id = $1 returning id`, [orgItem]))).toHaveLength(0);
    expect(await asUser(db, leo, (t) => rows(t, `delete from public.transactions where id = $1 returning id`, [orgItem]))).toHaveLength(0);
  });

  it("o âmbito de um valor em aberto não muda numa edição", async () => {
    await expect(
      asUser(db, ana, (t) => t.query(`update public.transactions set organization_id = null, owner_user_id = $1 where id = $2`, [ana, orgItem])),
    ).rejects.toThrow(/permission denied/);
  });

  it("anónimos não leem", async () => {
    await expect(asUser(db, null, (t) => t.query(`select id from public.transactions`))).rejects.toThrow(/permission denied/);
  });
});
