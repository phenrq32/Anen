import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string;
let leo: string; // leitor
let rui: string; // externo
let org: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const count = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows.length;

async function newQuote(user: string, scopeOrg: string | null, title = "Pintura"): Promise<{ id: string; number: string }> {
  return asUser(db, user, (tx) =>
    one(tx, `insert into public.quotes (organization_id, owner_user_id, title, currency_code, number) values ($1, $2, $3, 'EUR', 'x') returning id, number`, [
      scopeOrg,
      scopeOrg ? null : user,
      title,
    ]),
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@q.pt");
  leo = await createUser(db, "leo@q.pt");
  rui = await createUser(db, "rui@q.pt");
  org = await asUser(db, ana, async (tx) => (await one<{ id: string }>(tx, `select public.create_organization('business', 'Q Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`)).id);
  const token = await asUser(db, ana, async (tx) => {
    const viewer = (await one<{ id: string }>(tx, `select id from public.roles where key = 'viewer' and organization_id is null`)).id;
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@q.pt', $2)`, [org, viewer])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
});

describe("orçamentos", () => {
  it("numera sequencialmente por âmbito, ignorando o número enviado pelo cliente", async () => {
    const year = new Date().getFullYear();
    const a = await newQuote(ana, org);
    const b = await newQuote(ana, org);
    const personal = await newQuote(ana, null);
    expect(a.number).toBe(`ORC-${year}-0001`);
    expect(b.number).toBe(`ORC-${year}-0002`);
    expect(personal.number).toBe(`ORC-${year}-0001`);
  });

  it("isola por organização e o leitor não escreve", async () => {
    expect(await asUser(db, leo, (tx) => count(tx, `select id from public.quotes where organization_id = $1`, [org]))).toBe(2);
    expect(await asUser(db, rui, (tx) => count(tx, `select id from public.quotes`))).toBe(0);
    expect(await asUser(db, leo, (tx) => count(tx, `select id from public.quotes where owner_user_id = $1`, [ana]))).toBe(0);
    await expect(newQuote(leo, org)).rejects.toThrow(/row-level security/);
    await expect(newQuote(rui, org)).rejects.toThrow(/row-level security/);
  });

  it("linhas seguem o acesso do orçamento", async () => {
    const q = await newQuote(ana, org, "Com linhas");
    await asUser(db, ana, (tx) =>
      tx.query(`insert into public.quote_items (quote_id, position, kind, description, quantity, unit, unit_cost_minor, total_cost_minor) values ($1, 0, 'labor', 'Pintura', 10, 'h', 1800, 18000)`, [q.id]),
    );
    expect(await asUser(db, leo, (tx) => count(tx, `select id from public.quote_items where quote_id = $1`, [q.id]))).toBe(1);
    expect(await asUser(db, rui, (tx) => count(tx, `select id from public.quote_items where quote_id = $1`, [q.id]))).toBe(0);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.quote_items (quote_id, position, kind, description, quantity, unit_cost_minor, total_cost_minor) values ($1, 1, 'labor', 'x', 1, 1, 1)`, [q.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("estados seguem o fluxo e um orçamento aceite fica bloqueado", async () => {
    const q = await newQuote(ana, org, "Fluxo");
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set status = 'accepted' where id = $1`, [q.id]))).rejects.toThrow(/quote_status_invalid/);
    await asUser(db, ana, (tx) => tx.query(`update public.quotes set status = 'sent' where id = $1`, [q.id]));
    await asUser(db, ana, (tx) => tx.query(`update public.quotes set status = 'accepted' where id = $1`, [q.id]));
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set total_minor = 1 where id = $1`, [q.id]))).rejects.toThrow(/quote_locked/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.quote_items (quote_id, position, kind, description, quantity, unit_cost_minor, total_cost_minor) values ($1, 0, 'labor', 'x', 1, 1, 1)`, [q.id])),
    ).rejects.toThrow(/quote_locked/);
    const history = await asUser(db, leo, (tx) => tx.query<{ to_status: string }>(`select to_status from public.quote_status_history where quote_id = $1 order by id`, [q.id]));
    expect(history.rows.map((r) => r.to_status)).toEqual(["sent", "accepted"]);
  });

  it("versões são imutáveis e numeradas", async () => {
    const q = await newQuote(ana, org, "Versões");
    const v1 = await asUser(db, ana, (tx) => one<{ v: number }>(tx, `select public.snapshot_quote($1) as v`, [q.id]));
    const v2 = await asUser(db, ana, (tx) => one<{ v: number }>(tx, `select public.snapshot_quote($1) as v`, [q.id]));
    expect([v1.v, v2.v]).toEqual([1, 2]);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quote_versions set snapshot = '{}'::jsonb`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, leo, (tx) => tx.query(`select public.snapshot_quote($1)`, [q.id]))).rejects.toThrow(/forbidden/);
  });

  it("não se altera o número, o âmbito nem o autor", async () => {
    const q = await newQuote(ana, org, "Imutáveis");
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set number = 'X' where id = $1`, [q.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set organization_id = null where id = $1`, [q.id]))).rejects.toThrow(/permission denied/);
  });

  it("exclui orçamentos em qualquer estado (com as linhas e o histórico); leitor e outra organização não", async () => {
    const ids: string[] = [];
    for (const target of ["draft", "sent", "accepted", "cancelled"]) {
      const q = await newQuote(ana, org, `Apagar ${target}`);
      await asUser(db, ana, (tx) =>
        tx.query(`insert into public.quote_items (quote_id, position, kind, description, quantity, unit_cost_minor, total_cost_minor) values ($1, 0, 'labor', 'x', 1, 1, 1)`, [q.id]),
      );
      if (target !== "draft") await asUser(db, ana, (tx) => tx.query(`update public.quotes set status = 'sent' where id = $1`, [q.id]));
      if (target === "accepted" || target === "cancelled") await asUser(db, ana, (tx) => tx.query(`update public.quotes set status = $2 where id = $1`, [q.id, target]));
      ids.push(q.id);
    }
    expect(await asUser(db, leo, (tx) => count(tx, `delete from public.quotes where id = any($1::uuid[]) returning id`, [ids]))).toBe(0);
    expect(await asUser(db, rui, (tx) => count(tx, `delete from public.quotes where id = any($1::uuid[]) returning id`, [ids]))).toBe(0);
    expect(await asUser(db, ana, (tx) => count(tx, `delete from public.quotes where id = any($1::uuid[]) returning id`, [ids]))).toBe(4);
    expect(await asUser(db, ana, (tx) => count(tx, `select id from public.quote_items where quote_id = any($1::uuid[])`, [ids]))).toBe(0);
  });

  it("modelos de sistema são legíveis e não editáveis", async () => {
    expect(await asUser(db, rui, (tx) => count(tx, `select key from public.quote_templates`))).toBeGreaterThanOrEqual(19);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quote_templates set name = 'x'`))).rejects.toThrow(/permission denied/);
  });
});

describe("fichas técnicas", () => {
  it("isola receitas e ingredientes", async () => {
    const recipe = await asUser(db, ana, (tx) =>
      one<{ id: string }>(tx, `insert into public.recipes (owner_user_id, name, currency_code, portions) values ($1, 'Bacalhau à Brás', 'EUR', 4) returning id`, [ana]),
    );
    await asUser(db, ana, (tx) =>
      tx.query(`insert into public.recipe_ingredients (recipe_id, position, name, quantity, unit, package_quantity, package_price_minor, waste_percent, cost_minor) values ($1, 0, 'Bacalhau', 600, 'g', 1000, 1590, 15, 1122)`, [recipe.id]),
    );
    expect(await asUser(db, leo, (tx) => count(tx, `select id from public.recipe_ingredients where recipe_id = $1`, [recipe.id]))).toBe(0);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.recipe_ingredients (recipe_id, position, name, quantity, unit, package_quantity, package_price_minor, cost_minor) values ($1, 1, 'x', 1, 'g', 1, 1, 1)`, [recipe.id])),
    ).rejects.toThrow(/row-level security/);
  });
});
