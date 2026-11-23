import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Importação de extratos (migration 2300): import_ref único por conta.
let db: PGlite;
let ana: string;
let a1: string;
let a2: string;
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const insert = (account: string, ref: string | null, description = "Café") =>
  asUser(db, ana, (tx) =>
    tx.query(
      `insert into public.transactions (owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on, description, import_ref)
       values ($1, $2, 'expense', 120, 'EUR', '2026-11-01', $3, $4) on conflict (account_id, import_ref) do nothing returning id`,
      [ana, account, description, ref],
    ),
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@extrato.pt");
  [a1, a2] = await asUser(db, ana, async (tx) => [
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [ana])).id,
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Cartão', 'credit_card', 'EUR') returning id`, [ana])).id,
  ]);
});

describe("importação de extratos", () => {
  it("a mesma linha do extrato não entra duas vezes na mesma conta (mas pode noutra conta)", async () => {
    expect((await insert(a1, "ofx:A1")).rows).toHaveLength(1);
    expect((await insert(a1, "ofx:A1")).rows).toHaveLength(0);
    expect((await insert(a2, "ofx:A1")).rows).toHaveLength(1);
    expect((await insert(a1, null)).rows).toHaveLength(1);
    expect((await insert(a1, null)).rows).toHaveLength(1);
  });

  it("a referência não se altera depois e tem tamanho limitado", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`update public.transactions set import_ref = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(insert(a1, "x".repeat(201))).rejects.toThrow(/check/);
  });
});
