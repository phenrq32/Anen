import { describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "../src/index";

/**
 * Direito ao apagamento (RGPD/LGPD): apagar um utilizador tem de funcionar mesmo com dados em
 * todos os módulos, apagando os dados pessoais e deixando intactos os da organização.
 */
describe("apagamento de conta", () => {
  it("apaga um utilizador com finanças, orçamentos e fichas técnicas (pessoais e de organização)", async () => {
    const db = await createTestDatabase();
    const ana = await createUser(db, "ana@erase.pt");
    const bia = await createUser(db, "bia@erase.pt");

    const org = await asUser(db, ana, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select public.create_organization('business', 'Apagar Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).rows[0]!.id;
      const admin = (await tx.query<{ id: string }>(`select id from public.roles where key = 'admin' and organization_id is null`)).rows[0]!.id;
      const token = (await tx.query<{ token: string }>(`select token from public.invite_member($1, 'bia@erase.pt', $2)`, [id, admin])).rows[0]!.token;
      return { id, token };
    });
    await asUser(db, bia, (tx) => tx.query(`select public.accept_invitation($1)`, [org.token]));
    // A Bia passa a proprietária para a Ana poder sair
    const owner = (await db.query<{ id: string }>(`select id from public.roles where key = 'owner' and organization_id is null`)).rows[0]!.id;
    const biaMember = (await db.query<{ id: string }>(`select id from public.organization_members where user_id = $1`, [bia])).rows[0]!.id;
    await asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [biaMember, owner]));

    await asUser(db, ana, async (tx) => {
      for (const scope of [`organization_id`, `owner_user_id`]) {
        const scopeValue = scope === "organization_id" ? org.id : ana;
        const acc = (await tx.query<{ id: string }>(`insert into public.financial_accounts (${scope}, name, kind, currency_code) values ($1, 'C', 'cash', 'EUR') returning id`, [scopeValue])).rows[0]!.id;
        await tx.query(`insert into public.transactions (${scope}, account_id, kind, amount_minor, currency_code, occurred_on, description) values ($1, $2, 'expense', 100, 'EUR', '2026-11-01', 'x')`, [scopeValue, acc]);
        await tx.query(`insert into public.recurring_transactions (${scope}, account_id, kind, amount_minor, currency_code, description, frequency, start_on, next_run_on) values ($1, $2, 'expense', 100, 'EUR', 'r', 'monthly', '2026-11-01', '2026-11-01')`, [scopeValue, acc]);
        await tx.query(`insert into public.savings_goals (${scope}, name, target_minor, currency_code) values ($1, 'g', 100, 'EUR')`, [scopeValue]);
        const q = (await tx.query<{ id: string }>(`insert into public.quotes (${scope}, title, currency_code, number) values ($1, 'q', 'EUR', 'x') returning id`, [scopeValue])).rows[0]!.id;
        await tx.query(`select public.snapshot_quote($1)`, [q]);
        await tx.query(`update public.quotes set status = 'sent' where id = $1`, [q]);
        await tx.query(`update public.quotes set status = 'accepted' where id = $1`, [q]);
        await tx.query(`insert into public.recipes (${scope}, name, currency_code, portions) values ($1, 'r', 'EUR', 1)`, [scopeValue]);
      }
    });

    await db.query(`delete from auth.users where id = $1`, [ana]);

    const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
    // Dados pessoais da Ana: apagados
    expect(await count(`select count(*)::int as n from public.transactions where owner_user_id is not null`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.quotes where owner_user_id is not null`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.recipes where owner_user_id is not null`)).toBe(0);
    // Dados da organização: mantidos, sem referência à Ana
    expect(await count(`select count(*)::int as n from public.transactions where organization_id = $1`, [org.id])).toBe(1);
    expect(await count(`select count(*)::int as n from public.quotes where organization_id = $1 and status = 'accepted' and created_by is null`, [org.id])).toBe(1);
    expect(await count(`select count(*)::int as n from public.recipes where organization_id = $1 and created_by is null`, [org.id])).toBe(1);
  });

  it("o autor não pode ser trocado por outra pessoa", async () => {
    const db = await createTestDatabase();
    const ana = await createUser(db, "ana@erase2.pt");
    const rui = await createUser(db, "rui@erase2.pt");
    const recipe = await asUser(db, ana, async (tx) =>
      (await tx.query<{ id: string }>(`insert into public.recipes (owner_user_id, name, currency_code, portions) values ($1, 'r', 'EUR', 1) returning id`, [ana])).rows[0]!.id,
    );
    await expect(asUser(db, ana, (tx) => tx.query(`update public.recipes set created_by = $2 where id = $1`, [recipe, rui]))).rejects.toThrow(/forbidden/);
  });
});
