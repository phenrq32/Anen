import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Dual Workspace · Fase 7 (§7): transferências entre o espaço pessoal e uma empresa (migration 3500).

let db: PGlite;
let ana: string; // dona da empresa
let leo: string; // leitor na empresa
let rui: string; // outra empresa
let org: string;
let ruiOrg: string;
let orgAccount: string;
let personalAccount: string;
let personalUsd: string;
let ruiAccount: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@transf.pt");
  leo = await createUser(db, "leo@transf.pt");
  rui = await createUser(db, "rui@transf.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Obras Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  ruiOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  const token = await asUser(db, ana, async (tx) => {
    const role = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@transf.pt', $2)`, [org, role])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  orgAccount = await asUser(db, ana, (tx) =>
    id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code, opening_balance_minor) values ($1, 'Banco empresa', 'checking', 'EUR', 1000000) returning id`, [org]),
  );
  personalAccount = await asUser(db, ana, (tx) =>
    id(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Conta pessoal', 'checking', 'EUR') returning id`, [ana]),
  );
  personalUsd = await asUser(db, ana, (tx) =>
    id(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Conta BRL', 'checking', 'BRL') returning id`, [ana]),
  );
  ruiAccount = await asUser(db, rui, (tx) =>
    id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco Rui', 'checking', 'EUR') returning id`, [ruiOrg]),
  );
});

const withdrawal = (over: Record<string, unknown> = {}) => ({
  client_ref: randomUUID(),
  source_type: "BUSINESS",
  source_id: org,
  source_account_id: orgAccount,
  destination_type: "PERSONAL",
  destination_id: ana,
  destination_account_id: personalAccount,
  amount_minor: "50000",
  transfer_date: "2026-11-20",
  transfer_type: "owner_withdrawal",
  description: "Levantamento do sócio",
  ...over,
});
const create = (user: string | null, p: Record<string, unknown>) =>
  asUser(db, user, (tx) => one<{ id: string }>(tx, `select public.create_cross_workspace_transfer($1::jsonb) as id`, [JSON.stringify(p)]));

describe("transferências entre ambientes", () => {
  it("cria os dois movimentos com a mesma referência, numa só operação", async () => {
    const { id: transfer } = await create(ana, withdrawal());
    const r = await asUser(db, ana, (tx) =>
      one<{ reference: string; status: string; src: string; dst: string }>(
        tx,
        `select reference, status, source_transaction_id as src, destination_transaction_id as dst from public.cross_workspace_transfers where id = $1`,
        [transfer],
      ),
    );
    expect(r.reference).toMatch(/^TRF-20261120-[0-9A-F]{6}$/);
    expect(r.status).toBe("completed");
    const txs = await asUser(db, ana, (tx) =>
      tx.query<{ id: string; kind: string; amount_minor: string; organization_id: string | null; owner_user_id: string | null; notes: string; category_id: string | null }>(
        `select id, kind, amount_minor, organization_id, owner_user_id, notes, category_id from public.transactions where id in ($1, $2)`,
        [r.src, r.dst],
      ),
    );
    const src = txs.rows.find((t) => t.id === r.src)!;
    const dst = txs.rows.find((t) => t.id === r.dst)!;
    expect([src.kind, Number(src.amount_minor), src.organization_id, src.owner_user_id]).toEqual(["expense", 50000, org, null]);
    expect([dst.kind, Number(dst.amount_minor), dst.organization_id, dst.owner_user_id]).toEqual(["income", 50000, null, ana]);
    expect([src.notes, dst.notes]).toEqual([r.reference, r.reference]);
    // Não classifica sozinha: sem categoria, a não ser a escolhida por quem cria
    expect([src.category_id, dst.category_id]).toEqual([null, null]);
  });

  it("repetir o mesmo pedido (client_ref) não duplica", async () => {
    const p = withdrawal();
    const count = () => asUser(db, ana, (tx) => one<{ n: number }>(tx, `select count(*)::int as n from public.transactions where account_id = $1`, [orgAccount]));
    const first = await create(ana, p);
    const before = (await count()).n;
    const again = await create(ana, p);
    expect(again.id).toBe(first.id);
    expect((await count()).n).toBe(before);
  });

  it("recusa moedas diferentes, contas de outro espaço e o mesmo espaço nos dois lados", async () => {
    await expect(create(ana, withdrawal({ destination_account_id: personalUsd }))).rejects.toThrow(/transfer_currency_mismatch/);
    await expect(create(ana, withdrawal({ destination_account_id: orgAccount }))).rejects.toThrow(/transfer_invalid/);
    await expect(create(ana, withdrawal({ destination_type: "BUSINESS", destination_id: org, destination_account_id: orgAccount }))).rejects.toThrow(
      /transfer_invalid/,
    );
    await expect(create(ana, withdrawal({ amount_minor: "0" }))).rejects.toThrow(/transfer_invalid/);
  });

  it("exige escrever finanças nos dois espaços (leitor, outra empresa, espaço pessoal alheio, anónimo)", async () => {
    await expect(create(leo, withdrawal({ destination_id: leo }))).rejects.toThrow(/forbidden/);
    await expect(create(rui, withdrawal({ source_id: ruiOrg, source_account_id: ruiAccount }))).rejects.toThrow(/forbidden/);
    await expect(create(rui, withdrawal({ source_id: ruiOrg, source_account_id: ruiAccount, destination_id: rui }))).rejects.toThrow(/transfer_invalid/);
    await expect(create(null, withdrawal())).rejects.toThrow(/permission denied|forbidden/);
    // Ninguém escreve diretamente na tabela
    await expect(
      asUser(db, ana, (tx) => tx.query(`delete from public.cross_workspace_transfers`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("os movimentos da transferência não mudam de valor nem se apagam à parte; a classificação de cada lado muda", async () => {
    const { id: transfer } = await create(ana, withdrawal());
    const { src } = await asUser(db, ana, (tx) => one<{ src: string }>(tx, `select source_transaction_id as src from public.cross_workspace_transfers where id = $1`, [transfer]));
    await expect(asUser(db, ana, (tx) => tx.query(`update public.transactions set amount_minor = 1 where id = $1`, [src]))).rejects.toThrow(/transfer_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.transactions where id = $1`, [src]))).rejects.toThrow(/transfer_locked/);
    const cat = await asUser(db, ana, (tx) => id(tx, `insert into public.transaction_categories (organization_id, kind, name) values ($1, 'expense', 'Levantamentos') returning id`, [org]));
    await asUser(db, ana, (tx) => tx.query(`update public.transactions set category_id = $2, description = 'Levantamento (novembro)' where id = $1`, [src, cat]));
  });

  it("reverter cria movimentos de compensação e é idempotente; o leitor não reverte", async () => {
    const { id: transfer } = await create(ana, withdrawal({ amount_minor: "12345" }));
    await expect(asUser(db, leo, (tx) => tx.query(`select public.revert_cross_workspace_transfer($1, 'x')`, [transfer]))).rejects.toThrow(/forbidden/);
    await asUser(db, ana, (tx) => tx.query(`select public.revert_cross_workspace_transfer($1, 'Engano no valor')`, [transfer]));
    await asUser(db, ana, (tx) => tx.query(`select public.revert_cross_workspace_transfer($1, 'Engano no valor')`, [transfer]));
    const x = await asUser(db, ana, (tx) =>
      one<{ status: string; rs: string; rd: string; reason: string }>(
        tx,
        `select status, reversal_source_transaction_id as rs, reversal_destination_transaction_id as rd, revert_reason as reason from public.cross_workspace_transfers where id = $1`,
        [transfer],
      ),
    );
    expect([x.status, x.reason]).toEqual(["reverted", "Engano no valor"]);
    const comp = await asUser(db, ana, (tx) =>
      tx.query<{ id: string; kind: string; amount_minor: string }>(`select id, kind, amount_minor from public.transactions where id in ($1, $2)`, [x.rs, x.rd]),
    );
    const pick = (txId: string) => comp.rows.filter((t) => t.id === txId).map((t) => [t.kind, Number(t.amount_minor)])[0];
    expect(pick(x.rs)).toEqual(["income", 12345]);
    expect(pick(x.rd)).toEqual(["expense", 12345]);
  });

  it("o leitor da empresa vê as transferências da empresa; outra empresa e anónimos não", async () => {
    const own = await asUser(db, leo, (tx) => one<{ n: number }>(tx, `select count(*)::int as n from public.cross_workspace_transfers`));
    expect(own.n).toBeGreaterThan(0);
    const other = await asUser(db, rui, (tx) => one<{ n: number }>(tx, `select count(*)::int as n from public.cross_workspace_transfers`));
    expect(other.n).toBe(0);
    await expect(asUser(db, null, (tx) => tx.query(`select 1 from public.cross_workspace_transfers`))).rejects.toThrow(/permission denied/);
  });

  it("apagar a organização continua possível; o movimento pessoal fica com a referência", async () => {
    const tmpOrg = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Temporária Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
    const tmpAcc = await asUser(db, ana, (tx) =>
      id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco T', 'checking', 'EUR') returning id`, [tmpOrg]),
    );
    const { id: transfer } = await create(ana, withdrawal({ source_id: tmpOrg, source_account_id: tmpAcc }));
    const { dst, reference } = await asUser(db, ana, (tx) =>
      one<{ dst: string; reference: string }>(tx, `select destination_transaction_id as dst, reference from public.cross_workspace_transfers where id = $1`, [transfer]),
    );
    await db.query(`delete from public.organizations where id = $1`, [tmpOrg]);
    const left = await asUser(db, ana, (tx) => one<{ notes: string }>(tx, `select notes from public.transactions where id = $1`, [dst]));
    expect(left.notes).toBe(reference);
    const gone = await asUser(db, ana, (tx) => one<{ n: number }>(tx, `select count(*)::int as n from public.cross_workspace_transfers where id = $1`, [transfer]));
    expect(gone.n).toBe(0);
  });
});
