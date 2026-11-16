import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária
let leo: string; // leitor
let rui: string; // sem relação
let org: string;
let account: string;
let project: string;
let supplier: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@rec.pt");
  leo = await createUser(db, "leo@rec.pt");
  rui = await createUser(db, "rui@rec.pt");
  org = await asUser(db, ana, async (tx) => (await one<{ id: string }>(tx, `select public.create_organization('business', 'Rec Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  const token = await asUser(db, ana, async (tx) => {
    const viewer = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@rec.pt', $2)`, [org, viewer])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  [account, project, supplier] = await asUser(db, ana, async (tx) => [
    (await one<{ id: string }>(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org])).id,
    (await one<{ id: string }>(tx, `insert into public.projects (organization_id, name, currency_code) values ($1, 'Obra', 'EUR') returning id`, [org])).id,
    (await one<{ id: string }>(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Senhorio') returning id`, [org])).id,
  ]);
});

describe("recorrentes completos", () => {
  it("geram movimentos pendentes, com vencimento, fornecedor e projeto (no servidor e pelo utilizador)", async () => {
    const rec = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(
        tx,
        `insert into public.recurring_transactions (organization_id, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on, end_on,
                                                    contact_id, project_id, cost_kind, generate_pending, due_days)
         values ($1, $2, 'expense', 80000, 'EUR', 'Renda do armazém', 'monthly', '2020-01-01', '2020-01-01', '2020-02-29', $3, $4, 'overhead', true, 8) returning id`,
        [org, account, supplier, project],
      )).id,
    );
    await db.query(`select private.run_daily_jobs()`);
    const rows = await asUser(db, ana, (tx) =>
      tx.query<{ occurred_on: string; due_on: string; payment_status: string; contact_id: string; project_id: string; cost_kind: string }>(
        `select occurred_on::text, due_on::text, payment_status, contact_id, project_id, cost_kind from public.transactions where recurring_id = $1 order by occurred_on`,
        [rec],
      ),
    );
    expect(rows.rows).toEqual([
      { occurred_on: "2020-01-01", due_on: "2020-01-09", payment_status: "pending", contact_id: supplier, project_id: project, cost_kind: "overhead" },
      { occurred_on: "2020-02-01", due_on: "2020-02-09", payment_status: "pending", contact_id: supplier, project_id: project, cost_kind: "overhead" },
    ]);
  });

  it("pode ser editado (valor, descrição, ligações), mas não o calendário", async () => {
    const rec = await asUser(db, ana, async (tx) =>
      (await one<{ id: string }>(tx, `insert into public.recurring_transactions (organization_id, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on) values ($1, $2, 'expense', 1000, 'EUR', 'Internet', 'monthly', '2030-01-01', '2030-01-01') returning id`, [org, account])).id,
    );
    const updated = await asUser(db, ana, (tx) => one<{ amount_minor: number }>(tx, `update public.recurring_transactions set amount_minor = 1500, description = 'Internet fibra', generate_pending = true, due_days = 5 where id = $1 returning amount_minor`, [rec]));
    expect(Number(updated.amount_minor)).toBe(1500);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.recurring_transactions set start_on = '2031-01-01' where id = $1`, [rec]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.recurring_transactions set next_run_on = '2031-01-01' where id = $1`, [rec]))).rejects.toThrow(/permission denied/);
    // O leitor não edita
    expect((await asUser(db, leo, (tx) => tx.query(`update public.recurring_transactions set amount_minor = 1 where id = $1 returning id`, [rec]))).rows).toHaveLength(0);
  });

  it("rejeita ligações de outro âmbito", async () => {
    const foreign = await asUser(db, rui, async (tx) => (await one<{ id: string }>(tx, `insert into public.contacts (owner_user_id, kind, name) values ($1, 'supplier', 'X') returning id`, [rui])).id);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.recurring_transactions (organization_id, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on, contact_id) values ($1, $2, 'expense', 1, 'EUR', 'x', 'monthly', '2030-01-01', '2030-01-01', $3)`, [org, account, foreign])),
    ).rejects.toThrow(/contact_invalid/);
  });
});

describe("anexos de movimentos", () => {
  let tx: string;
  let attachment: string;

  beforeAll(async () => {
    tx = await asUser(db, ana, async (t) => (await one<{ id: string }>(t, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 12300, 'EUR', '2026-11-10', 'Tintas') returning id`, [org, account])).id);
  });

  it("quem escreve finanças anexa; o âmbito vem do movimento e o caminho tem de lhe pertencer", async () => {
    attachment = await asUser(db, ana, async (t) =>
      (await one<{ id: string; organization_id: string }>(t, `insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'fatura.pdf', 'application/pdf', 2048) returning id, organization_id`, [tx, `${org}/${tx}/a.pdf`])).id,
    );
    expect(attachment).toBeTruthy();
    await expect(
      asUser(db, ana, (t) => t.query(`insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'x.pdf', 'application/pdf', 1)`, [tx, `${rui}/${tx}/x.pdf`])),
    ).rejects.toThrow(/attachment_path_invalid/);
    await expect(
      asUser(db, ana, (t) => t.query(`insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'x.exe', 'application/x-msdownload', 1)`, [tx, `${org}/${tx}/x.exe`])),
    ).rejects.toThrow(/check constraint/);
  });

  it("o leitor vê mas não anexa nem apaga; outra pessoa e anónimos não veem", async () => {
    expect((await asUser(db, leo, (t) => t.query(`select id from public.transaction_attachments`))).rows).toHaveLength(1);
    await expect(
      asUser(db, leo, (t) => t.query(`insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'y.pdf', 'application/pdf', 1)`, [tx, `${org}/${tx}/y.pdf`])),
    ).rejects.toThrow(/row-level security/);
    expect((await asUser(db, leo, (t) => t.query(`delete from public.transaction_attachments where id = $1 returning id`, [attachment]))).rows).toHaveLength(0);
    expect((await asUser(db, rui, (t) => t.query(`select id from public.transaction_attachments`))).rows).toHaveLength(0);
    await expect(asUser(db, null, (t) => t.query(`select id from public.transaction_attachments`))).rejects.toThrow(/permission denied/);
  });

  it("a verificação de caminho do Storage só autoriza quem escreve no âmbito do movimento", async () => {
    const check = (user: string, path: string) => asUser(db, user, async (t) => (await one<{ ok: boolean }>(t, `select private.can_write_attachment_path($1) as ok`, [path])).ok);
    expect(await check(ana, `${org}/${tx}/b.pdf`)).toBe(true);
    expect(await check(leo, `${org}/${tx}/b.pdf`)).toBe(false);
    expect(await check(rui, `${org}/${tx}/b.pdf`)).toBe(false);
    expect(await check(ana, `${rui}/${tx}/b.pdf`)).toBe(false);
    expect(await check(ana, `${org}/${tx}/sub/b.pdf`)).toBe(false);
  });

  it("anexos não se alteram; apagar o movimento apaga o registo; apagar o autor mantém o anexo", async () => {
    await expect(asUser(db, ana, (t) => t.query(`update public.transaction_attachments set file_name = 'z' where id = $1`, [attachment]))).rejects.toThrow(/permission denied/);
    const other = await createUser(db, "bia@rec.pt");
    const t2 = await asUser(db, other, async (t) => {
      const acc = (await one<{ id: string }>(t, `insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'C', 'cash', 'EUR') returning id`, [other])).id;
      return (await one<{ id: string }>(t, `insert into public.transactions (owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 1, 'EUR', '2026-11-10', 'x') returning id`, [other, acc])).id;
    });
    await asUser(db, other, (t) => t.query(`insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'r.jpg', 'image/jpeg', 10)`, [t2, `${other}/${t2}/r.jpg`]));
    await db.query(`delete from auth.users where id = $1`, [other]);
    expect((await db.query(`select id from public.transaction_attachments where transaction_id = $1`, [t2])).rows).toHaveLength(0);
    await db.query(`delete from auth.users where id = $1`, [ana]);
    expect((await db.query(`select created_by from public.transaction_attachments where id = $1`, [attachment])).rows).toEqual([{ created_by: null }]);
    await db.query(`delete from public.transactions where id = $1`, [tx]);
    expect((await db.query(`select id from public.transaction_attachments where id = $1`, [attachment])).rows).toHaveLength(0);
  });
});
