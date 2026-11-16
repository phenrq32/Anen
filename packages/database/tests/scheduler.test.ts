import { describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "../src/index";

/** Tarefas no servidor: os recorrentes são gerados sem ninguém abrir a aplicação. */
describe("tarefas diárias no servidor", () => {
  it("gera os recorrentes vencidos de todas as pessoas e organizações, isola falhas e regista a execução", async () => {
    const db = await createTestDatabase();
    const ana = await createUser(db, "ana@cron.pt");
    const rui = await createUser(db, "rui@cron.pt");
    const past = "2020-01-01";

    const org = await asUser(db, ana, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select public.create_organization('business', 'Cron Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).rows[0]!.id;
      const acc = (await tx.query<{ id: string }>(`insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [id])).rows[0]!.id;
      await tx.query(
        `insert into public.recurring_transactions (organization_id, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on, end_on)
         values ($1, $2, 'expense', 5000, 'EUR', 'Renda', 'monthly', $3, $3, '2020-03-31')`,
        [id, acc, past],
      );
      return id;
    });
    const archived = await asUser(db, rui, async (tx) => {
      const acc = (await tx.query<{ id: string }>(`insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Carteira', 'cash', 'EUR') returning id`, [rui])).rows[0]!.id;
      const ok = (await tx.query<{ id: string }>(`insert into public.financial_accounts (owner_user_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [rui])).rows[0]!.id;
      await tx.query(
        `insert into public.recurring_transactions (owner_user_id, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on, end_on)
         values ($1, $2, 'income', 100000, 'EUR', 'Salário', 'monthly', $4, $4, '2020-02-29'),
                ($1, $3, 'expense', 1000, 'EUR', 'Ginásio', 'monthly', $4, $4, '2020-02-29')`,
        [rui, ok, acc, past],
      );
      await tx.query(`update public.financial_accounts set archived_at = now() where id = $1`, [acc]);
      return acc;
    });

    // Corre como o pg_cron (sem utilizador autenticado)
    await db.query(`select private.run_daily_jobs()`);

    const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
    expect(await count(`select count(*)::int as n from public.transactions where organization_id = $1`, [org])).toBe(3); // jan, fev, mar
    expect(await count(`select count(*)::int as n from public.transactions where owner_user_id = $1 and description = 'Salário'`, [rui])).toBe(2);
    // Conta arquivada: falha isolada, sem movimentos e sem travar os outros
    expect(await count(`select count(*)::int as n from public.transactions where account_id = $1`, [archived])).toBe(0);

    const run = (await db.query<{ status: string; processed: number; failed: number; finished_at: string | null }>(
      `select status, processed, failed, finished_at from public.job_runs order by id desc limit 1`,
    )).rows[0]!;
    expect(run).toMatchObject({ status: "partial", processed: 5, failed: 1 });
    expect(run.finished_at).not.toBeNull();

    // Idempotente: uma segunda execução não duplica
    await db.query(`select private.run_daily_jobs()`);
    expect(await count(`select count(*)::int as n from public.transactions`)).toBe(5);
    // O autor do recorrente fica como autor dos movimentos gerados
    expect(await count(`select count(*)::int as n from public.transactions where created_by is null`)).toBe(0);

    // O registo de tarefas não é legível por utilizadores normais nem anónimos
    expect((await asUser(db, ana, (tx) => tx.query(`select id from public.job_runs`))).rows).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.job_runs`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`select private.run_daily_jobs()`))).rejects.toThrow(/permission denied/);
  });
});
