import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Prompt 03 · Fase 4: desconto, produto/serviço nas linhas e descrição do projeto (migration 1200).

let db: PGlite;
let ana: string; // proprietária
let leo: string; // leitor
let rui: string; // outra organização
let org: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@desc.pt");
  leo = await createUser(db, "leo@desc.pt");
  rui = await createUser(db, "rui@desc.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Obras Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await asUser(db, rui, (tx) => tx.query(`select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon')`));
  const token = await asUser(db, ana, async (tx) => {
    const role = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@desc.pt', $2)`, [org, role])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
});

const newQuote = () =>
  asUser(db, ana, (tx) => id(tx, `insert into public.quotes (organization_id, number, title, currency_code) values ($1, 'x', 'Cozinha', 'EUR') returning id`, [org]));

/** Grava como a aplicação: 800,00 de custo, 1000,00 com margem, 10 % de desconto, 23 % de IVA. */
const save = (quote: string, extra: Record<string, string> = {}, items = defaultItems) =>
  asUser(db, ana, (tx) =>
    tx.query(`select public.save_quote_content($1, $2::jsonb, $3::jsonb)`, [
      quote,
      JSON.stringify({
        title: "Cozinha",
        description: "Remodelação completa da cozinha",
        margin_percent: "20",
        tax_rate_percent: "23",
        discount_percent: "10",
        discount_fixed_minor: "0",
        discount_minor: "10000",
        total_cost_minor: "80000",
        price_before_tax_minor: "90000",
        tax_minor: "20700",
        total_minor: "110700",
        ...extra,
      }),
      JSON.stringify(items),
    ]),
  );
const defaultItems = [
  { position: 0, kind: "labor", nature: "service", description: "Montagem", quantity: "10", unit: "h", unit_cost_minor: "5000", total_cost_minor: "50000" },
  { position: 1, kind: "material", nature: "product", description: "Bancada", quantity: "1", unit: "un", unit_cost_minor: "30000", total_cost_minor: "30000" },
];

describe("desconto do orçamento", () => {
  it("guarda o desconto e o leitor vê-o; outra organização não", async () => {
    const quote = await newQuote();
    await save(quote);
    const read = await asUser(db, leo, (tx) => rows(tx, `select discount_percent, discount_fixed_minor, discount_minor, price_before_tax_minor from public.quotes where id = $1`, [quote]));
    expect(read).toEqual([{ discount_percent: "10.000", discount_fixed_minor: 0, discount_minor: 10000, price_before_tax_minor: 90000 }]);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.quotes where id = $1`, [quote]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `update public.quotes set discount_minor = 0 where id = $1 returning id`, [quote]))).toHaveLength(0);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.quotes set discount_minor = 0 where id = $1 returning id`, [quote]))).toHaveLength(0);
  });

  it("sem os campos novos, grava sem desconto (compatível com clientes antigos)", async () => {
    const quote = await newQuote();
    await asUser(db, ana, (tx) =>
      tx.query(
        `select public.save_quote_content($1, jsonb_build_object('title', 'X', 'margin_percent', '20', 'tax_rate_percent', '0',
           'total_cost_minor', '0', 'price_before_tax_minor', '0', 'tax_minor', '0', 'total_minor', '0'), '[]'::jsonb)`,
        [quote],
      ),
    );
    expect(await asUser(db, ana, (tx) => rows(tx, `select discount_percent, discount_minor from public.quotes where id = $1`, [quote]))).toEqual([
      { discount_percent: "0.000", discount_minor: 0 },
    ]);
  });

  it("recusa percentagem e valor fixo ao mesmo tempo, e valores fora dos limites", async () => {
    const quote = await newQuote();
    await expect(save(quote, { discount_fixed_minor: "500" })).rejects.toThrow(/quotes_discount_single/);
    await expect(save(quote, { discount_percent: "120" })).rejects.toThrow(/check constraint/);
    await expect(save(quote, { discount_percent: "0", discount_minor: "-1" })).rejects.toThrow(/check constraint/);
  });

  it("depois de aceite, o desconto fica bloqueado", async () => {
    const quote = await newQuote();
    await save(quote);
    await asUser(db, ana, async (tx) => {
      await tx.query(`update public.quotes set status = 'sent' where id = $1`, [quote]);
      await tx.query(`update public.quotes set status = 'accepted' where id = $1`, [quote]);
    });
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set discount_percent = 5 where id = $1`, [quote]))).rejects.toThrow(/quote_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set discount_minor = 1 where id = $1`, [quote]))).rejects.toThrow(/quote_locked/);
  });
});

describe("produto ou serviço nas linhas", () => {
  it("guarda a natureza de cada linha e assume serviço quando não vem", async () => {
    const quote = await newQuote();
    await save(quote, {}, [...defaultItems, { position: 2, kind: "travel", description: "Deslocação", quantity: "1", unit: "km", unit_cost_minor: "0", total_cost_minor: "0" } as never]);
    const read = await asUser(db, leo, (tx) => rows(tx, `select nature from public.quote_items where quote_id = $1 order by position`, [quote]));
    expect(read.map((r) => (r as { nature: string }).nature)).toEqual(["service", "product", "service"]);
    const snapshot = await asUser(db, ana, (tx) =>
      one<{ n: string }>(tx, `select snapshot -> 'items' -> 1 ->> 'nature' as n from public.quote_versions where quote_id = $1 order by version desc limit 1`, [quote]),
    );
    expect(snapshot.n).toBe("product");
  });

  it("recusa naturezas desconhecidas", async () => {
    const quote = await newQuote();
    await expect(save(quote, {}, [{ ...defaultItems[0]!, nature: "rental" }])).rejects.toThrow(/check constraint/);
  });
});

describe("descrição do projeto", () => {
  it("o projeto criado do orçamento herda a descrição e a receita já descontada", async () => {
    const quote = await newQuote();
    await save(quote);
    const project = await asUser(db, ana, async (tx) => {
      await tx.query(`update public.quotes set status = 'sent' where id = $1`, [quote]);
      await tx.query(`update public.quotes set status = 'accepted' where id = $1`, [quote]);
      return (await one<{ p: string }>(tx, `select public.create_project_from_quote($1) as p`, [quote])).p;
    });
    expect(await asUser(db, leo, (tx) => rows(tx, `select description, planned_cost_minor, planned_revenue_minor from public.projects where id = $1`, [project]))).toEqual([
      { description: "Remodelação completa da cozinha", planned_cost_minor: 80000, planned_revenue_minor: 90000 },
    ]);
  });

  it("só quem escreve na organização edita a descrição", async () => {
    const project = await asUser(db, ana, (tx) =>
      id(tx, `insert into public.projects (organization_id, name, currency_code, description) values ($1, 'Telhado', 'EUR', 'Substituir telhas') returning id`, [org]),
    );
    await asUser(db, ana, (tx) => tx.query(`update public.projects set description = 'Substituir telhas e caleiras' where id = $1`, [project]));
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.projects set description = 'x' where id = $1 returning id`, [project]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `update public.projects set description = 'x' where id = $1 returning id`, [project]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.projects where id = $1`, [project]))).toHaveLength(0);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.projects set description = repeat('a', 4001) where id = $1`, [project])),
    ).rejects.toThrow(/check constraint/);
    expect(await asUser(db, ana, (tx) => one<{ description: string }>(tx, `select description from public.projects where id = $1`, [project]))).toEqual({
      description: "Substituir telhas e caleiras",
    });
  });
});
