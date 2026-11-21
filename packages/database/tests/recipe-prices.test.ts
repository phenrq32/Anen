import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Prompt 03 · Fase 5: fichas técnicas ligadas aos preços registados de fornecedores (migration 1300).

let db: PGlite;
let ana: string; // proprietária
let eva: string; // cozinha: quotes.* mas sem business.*
let leo: string; // leitor
let rui: string; // outra organização
let org: string;
let supplier: string;
let otherSupplier: string;
let flourOld: string; // farinha, 1,00 €/kg em outubro
let flourNew: string; // farinha, 1,20 €/kg em novembro
let butter: string;
let usdPrice: string;
let ruiPrice: string;
let recipe: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async <T = Record<string, unknown>>(tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

const price = (user: string, scopeOrg: string, contact: string, item: string, unit: string, minor: number, on: string, currency = "EUR") =>
  asUser(db, user, (tx) =>
    id(
      tx,
      `insert into public.supplier_prices (organization_id, contact_id, item_name, unit, unit_price_minor, currency_code, observed_on)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [scopeOrg, contact, item, unit, minor, currency, on],
    ),
  );

const ingredient = (name: string, supplierPrice: string | null, packagePrice: number) => ({
  position: 0,
  name,
  quantity: "500",
  unit: "g",
  package_quantity: "1000",
  package_price_minor: String(packagePrice),
  waste_percent: "0",
  cost_minor: String(packagePrice / 2),
  supplier_price_id: supplierPrice,
});

const save = (user: string, items: ReturnType<typeof ingredient>[]) =>
  asUser(db, user, (tx) =>
    tx.query(`select public.save_recipe_content($1, $2::jsonb, $3::jsonb)`, [
      recipe,
      JSON.stringify({
        name: "Pão",
        portions: "10",
        target_food_cost_percent: "30",
        minimum_margin_percent: "0",
        tax_rate_percent: "0",
        energy_minor: "0",
        water_minor: "0",
        labor_minor: "0",
        packaging_minor: "0",
        overhead_minor: "0",
        cost_per_portion_minor: "5",
        ingredient_cost_per_portion_minor: "5",
        recommended_price_minor: "17",
      }),
      JSON.stringify(items.map((it, position) => ({ ...it, position }))),
    ]),
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@pao.pt");
  eva = await createUser(db, "eva@pao.pt");
  leo = await createUser(db, "leo@pao.pt");
  rui = await createUser(db, "rui@pao.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Padaria Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  const otherOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));

  const [kitchenToken, viewerToken] = await asUser(db, ana, async (tx) => {
    const kitchen = (await one<{ id: string }>(tx, `select public.upsert_role($1, 'Cozinha', array['quotes.read', 'quotes.write']) as id`, [org])).id;
    const viewer = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return [
      (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'eva@pao.pt', $2)`, [org, kitchen])).token,
      (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@pao.pt', $2)`, [org, viewer])).token,
    ];
  });
  await asUser(db, eva, (tx) => tx.query(`select public.accept_invitation($1)`, [kitchenToken]));
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [viewerToken]));

  [supplier, otherSupplier] = await asUser(db, ana, async (tx) => [
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Moagem Central') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Laticínios Norte') returning id`, [org]),
  ]);
  const ruiSupplier = await asUser(db, rui, (tx) => id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'X') returning id`, [otherOrg]));

  flourOld = await price(ana, org, supplier, "Farinha T65", "kg", 100, "2026-10-01");
  butter = await price(ana, org, otherSupplier, "Manteiga", "kg", 800, "2026-10-01");
  usdPrice = await price(ana, org, supplier, "Fermento", "kg", 500, "2026-10-01", "BRL");
  ruiPrice = await price(rui, otherOrg, ruiSupplier, "Farinha", "kg", 90, "2026-10-01");
  recipe = await asUser(db, ana, (tx) => id(tx, `insert into public.recipes (organization_id, name, currency_code, portions) values ($1, 'Pão', 'EUR', 10) returning id`, [org]));
});

describe("ligação a preços de fornecedores", () => {
  it("guarda a ligação; o leitor vê-a", async () => {
    await save(ana, [ingredient("Farinha", flourOld, 100), ingredient("Manteiga", butter, 800), ingredient("Sal", null, 50)]);
    const read = await asUser(db, leo, (tx) => rows<{ name: string; supplier_price_id: string | null }>(tx, `select name, supplier_price_id from public.recipe_ingredients where recipe_id = $1 order by position`, [recipe]));
    expect(read).toEqual([
      { name: "Farinha", supplier_price_id: flourOld },
      { name: "Manteiga", supplier_price_id: butter },
      { name: "Sal", supplier_price_id: null },
    ]);
  });

  it("recusa preços de outra organização ou noutra moeda", async () => {
    await expect(save(ana, [ingredient("Farinha", ruiPrice, 90)])).rejects.toThrow(/supplier_price_invalid/);
    await expect(save(ana, [ingredient("Fermento", usdPrice, 500)])).rejects.toThrow(/supplier_price_invalid/);
    // A ficha não mudou (transação revertida).
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.recipe_ingredients where recipe_id = $1`, [recipe]))).toHaveLength(3);
  });

  it("quem não pode ver os preços de fornecedores não cria ligações novas, mas grava a ficha com as existentes", async () => {
    expect(await asUser(db, eva, (tx) => rows(tx, `select id from public.supplier_prices`))).toHaveLength(0);
    await expect(save(eva, [ingredient("Farinha", flourOld, 100), ingredient("Manteiga", butter, 800), ingredient("Fermento", usdPrice, 500)])).rejects.toThrow(
      /supplier_price_invalid/,
    );
    await save(eva, [ingredient("Farinha", flourOld, 100), ingredient("Manteiga", butter, 800), ingredient("Sal", null, 60)]);
    expect(await asUser(db, eva, (tx) => rows(tx, `select id from public.recipe_ingredients where recipe_id = $1 and supplier_price_id is not null`, [recipe]))).toHaveLength(2);
    // Também não vê o que mudou nos preços (função com o RLS de quem pergunta).
    expect(await asUser(db, eva, (tx) => rows(tx, `select * from public.recipe_price_updates($1)`, [recipe]))).toHaveLength(0);
  });

  it("o leitor e outra organização não gravam fichas", async () => {
    await expect(save(leo, [ingredient("Farinha", flourOld, 100)])).rejects.toThrow(/forbidden/);
    await expect(save(rui, [ingredient("Farinha", flourOld, 100)])).rejects.toThrow(/forbidden/);
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.recipe_price_updates()`))).toHaveLength(0);
  });
});

describe("preços mais recentes", () => {
  it("sem preços novos, nada a atualizar", async () => {
    expect(await asUser(db, ana, (tx) => rows(tx, `select * from public.recipe_price_updates($1)`, [recipe]))).toHaveLength(0);
  });

  it("um preço mais recente do mesmo artigo e fornecedor aparece, com o valor usado e o novo", async () => {
    flourNew = await price(ana, org, supplier, "  farinha   t65 ", "KG", 120, "2026-11-15");
    // Outro fornecedor ou outra unidade não contam como o mesmo artigo.
    await price(ana, org, otherSupplier, "Farinha T65", "kg", 95, "2026-11-20");
    await price(ana, org, supplier, "Farinha T65", "saco 25 kg", 2500, "2026-11-20");
    const updates = await asUser(db, leo, (tx) =>
      rows(tx, `select linked_price_id, used_price_minor, latest_price_id, latest_price_minor, supplier_name from public.recipe_price_updates($1)`, [recipe]),
    );
    expect(updates).toEqual([{ linked_price_id: flourOld, used_price_minor: 100, latest_price_id: flourNew, latest_price_minor: 120, supplier_name: "Moagem Central" }]);
  });

  it("depois de atualizar a ficha, deixa de aparecer; o custo fica no histórico", async () => {
    await save(ana, [ingredient("Farinha", flourNew, 120), ingredient("Manteiga", butter, 800)]);
    expect(await asUser(db, ana, (tx) => rows(tx, `select * from public.recipe_price_updates()`))).toHaveLength(0);
    const history = await asUser(db, ana, (tx) => rows(tx, `select id from public.recipe_cost_history where recipe_id = $1`, [recipe]));
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  it("corrigir o valor do registo ligado também conta como mudança", async () => {
    await asUser(db, ana, (tx) => tx.query(`update public.supplier_prices set unit_price_minor = 850 where id = $1`, [butter]));
    const updates = await asUser(db, ana, (tx) => rows(tx, `select latest_price_id, used_price_minor, latest_price_minor from public.recipe_price_updates($1)`, [recipe]));
    expect(updates).toEqual([{ latest_price_id: butter, used_price_minor: 800, latest_price_minor: 850 }]);
  });

  it("apagar o preço do fornecedor desliga o ingrediente e mantém o preço usado", async () => {
    await asUser(db, ana, (tx) => tx.query(`delete from public.supplier_prices where id = $1`, [butter]));
    const read = await asUser(db, ana, (tx) =>
      rows(tx, `select supplier_price_id, package_price_minor from public.recipe_ingredients where recipe_id = $1 and name = 'Manteiga'`, [recipe]),
    );
    expect(read).toEqual([{ supplier_price_id: null, package_price_minor: 800 }]);
  });
});
