import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { KNOWN_UNITS, unitConversionFactor } from "@anen/financial-engine";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Lotes e validades, consumo pelas fichas técnicas e avisos de validade (migration 2000).

let db: PGlite;
let ana: string; // proprietária
let eva: string; // cozinha: quotes.* sem business.*
let leo: string; // leitor
let rui: string; // outra organização
let org: string;
let otherOrg: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async <T = Record<string, unknown>>(tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

const newItem = (name: string, unit = "kg", user = ana, scope = org) =>
  asUser(db, user, (tx) => id(tx, `insert into public.stock_items (organization_id, name, unit, currency_code) values ($1, $2, $3, 'EUR') returning id`, [scope, name, unit]));

interface Move {
  kind: string;
  quantity: string;
  cost?: number;
  code?: string;
  expires?: string;
  lot?: string;
  on?: string;
}
const move = (item: string, m: Move, user = ana) =>
  asUser(db, user, (tx) =>
    id(
      tx,
      `insert into public.stock_movements (organization_id, item_id, kind, quantity, unit_cost_minor, lot_code, expires_on, lot_id, occurred_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::date, current_date)) returning id`,
      [org, item, m.kind, m.quantity, m.cost ?? null, m.code ?? null, m.expires ?? null, m.lot ?? null, m.on ?? null],
    ),
  );

type Lot = { id: string; code: string | null; expires_on: string | null; quantity_remaining: string; origin: string };
const lots = (item: string, user = ana) =>
  asUser(db, user, (tx) =>
    rows<Lot>(tx, `select id, code, expires_on::text, quantity_remaining, origin from public.stock_lots where item_id = $1 order by created_at, id`, [item]),
  );
const remaining = async (item: string) => Object.fromEntries((await lots(item)).map((l) => [l.code ?? l.origin, l.quantity_remaining]));

/** Invariante: a soma dos lotes é o saldo do artigo. */
const assertInvariant = async (item: string) => {
  const r = await asUser(db, ana, (tx) =>
    one<{ on_hand: string; lots: string }>(
      tx,
      `select i.quantity_on_hand::text as on_hand, coalesce(sum(l.quantity_remaining), 0)::numeric(14,3)::text as lots
       from public.stock_items i left join public.stock_lots l on l.item_id = i.id where i.id = $1 group by i.id`,
      [item],
    ),
  );
  expect(r.lots).toBe(r.on_hand);
};

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@lotes.pt");
  eva = await createUser(db, "eva@lotes.pt");
  leo = await createUser(db, "leo@lotes.pt");
  rui = await createUser(db, "rui@lotes.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Pastelaria Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  otherOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  const [kitchenToken, viewerToken] = await asUser(db, ana, async (tx) => {
    const kitchen = (await one<{ id: string }>(tx, `select public.upsert_role($1, 'Cozinha', array['quotes.read', 'quotes.write']) as id`, [org])).id;
    const viewer = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return [
      (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'eva@lotes.pt', $2)`, [org, kitchen])).token,
      (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@lotes.pt', $2)`, [org, viewer])).token,
    ];
  });
  await asUser(db, eva, (tx) => tx.query(`select public.accept_invitation($1)`, [kitchenToken]));
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [viewerToken]));
});

describe("lotes", () => {
  let milk: string;

  it("cada entrada cria um lote com código e validade", async () => {
    milk = await newItem("Leite");
    await move(milk, { kind: "in", quantity: "10", cost: 80, code: "  L-NOV ", expires: "2026-12-20" });
    await move(milk, { kind: "in", quantity: "6", cost: 90, code: "L-OUT", expires: "2026-12-01" });
    await move(milk, { kind: "in", quantity: "4", cost: 85 }); // sem lote nem validade
    expect(await lots(milk)).toMatchObject([
      { code: "L-NOV", expires_on: "2026-12-20", quantity_remaining: "10.000", origin: "in" },
      { code: "L-OUT", expires_on: "2026-12-01", quantity_remaining: "6.000", origin: "in" },
      { code: null, expires_on: null, quantity_remaining: "4.000", origin: "in" },
    ]);
    await assertInvariant(milk);
  });

  it("as saídas gastam primeiro o que vence antes (FEFO); os sem validade ficam para o fim", async () => {
    const out = await move(milk, { kind: "out", quantity: "8" });
    expect(await remaining(milk)).toEqual({ "L-NOV": "8.000", "L-OUT": "0.000", in: "4.000" });
    const parts = await asUser(db, leo, (tx) =>
      rows(tx, `select l.code, lm.quantity from public.stock_lot_movements lm join public.stock_lots l on l.id = lm.lot_id where lm.movement_id = $1 order by l.expires_on`, [out]),
    );
    expect(parts).toEqual([{ code: "L-OUT", quantity: "-6.000" }, { code: "L-NOV", quantity: "-2.000" }]);
    await move(milk, { kind: "loss", quantity: "9" }); // acaba o L-NOV (8) e tira 1 do sem validade
    expect(await remaining(milk)).toEqual({ "L-NOV": "0.000", "L-OUT": "0.000", in: "3.000" });
    await assertInvariant(milk);
  });

  it("escolher o lote: só desse lote, do mesmo artigo e com quantidade suficiente", async () => {
    const butter = await newItem("Manteiga");
    await move(butter, { kind: "in", quantity: "5", cost: 700, code: "A", expires: "2027-01-10" });
    await move(butter, { kind: "in", quantity: "5", cost: 700, code: "B", expires: "2027-03-10" });
    const [a, b] = await lots(butter);
    await move(butter, { kind: "loss", quantity: "2", lot: b!.id }); // o B estragou-se, apesar de o A vencer antes
    expect(await remaining(butter)).toEqual({ A: "5.000", B: "3.000" });
    await expect(move(butter, { kind: "out", quantity: "4", lot: b!.id })).rejects.toThrow(/stock_insufficient/);
    await expect(move(milk, { kind: "out", quantity: "1", lot: a!.id })).rejects.toThrow(/stock_lot_invalid/);
    await expect(move(butter, { kind: "count", quantity: "1", lot: a!.id })).rejects.toThrow(/stock_lot_invalid/);
    await expect(move(butter, { kind: "out", quantity: "1", code: "X" })).rejects.toThrow(/stock_lot_invalid/);
    await expect(move(butter, { kind: "out", quantity: "1", expires: "2027-01-01" })).rejects.toThrow(/stock_lot_invalid/);
    await assertInvariant(butter);
  });

  it("a contagem acerta os lotes: abaixo consome por FEFO, acima cria um lote de acerto", async () => {
    const eggs = await newItem("Ovos", "dz");
    await move(eggs, { kind: "in", quantity: "3", cost: 250, code: "E1", expires: "2026-12-05" });
    await move(eggs, { kind: "in", quantity: "3", cost: 250, code: "E2", expires: "2026-12-15" });
    await move(eggs, { kind: "count", quantity: "4" });
    expect(await remaining(eggs)).toEqual({ E1: "1.000", E2: "3.000" });
    await move(eggs, { kind: "count", quantity: "5.5" });
    expect(await remaining(eggs)).toEqual({ E1: "1.000", E2: "3.000", count: "1.500" });
    await move(eggs, { kind: "count", quantity: "0" });
    expect(await remaining(eggs)).toEqual({ E1: "0.000", E2: "0.000", count: "0.000" });
    await assertInvariant(eggs);
  });

  it("um movimento recusado não deixa nada a meio", async () => {
    const before = await remaining(milk);
    await expect(move(milk, { kind: "out", quantity: "100" })).rejects.toThrow(/stock_insufficient/);
    expect(await remaining(milk)).toEqual(before);
  });

  it("lotes e rastreio só se leem; ninguém os escreve diretamente", async () => {
    const [lot] = await lots(milk);
    expect((await lots(milk, leo)).length).toBeGreaterThan(0);
    for (const user of [ana, leo]) {
      await expect(asUser(db, user, (tx) => tx.query(`update public.stock_lots set quantity_remaining = 99 where id = $1`, [lot!.id]))).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, (tx) => tx.query(`delete from public.stock_lots where id = $1`, [lot!.id]))).rejects.toThrow(/permission denied/);
      await expect(
        asUser(db, user, (tx) => tx.query(`insert into public.stock_lots (organization_id, item_id, received_on, quantity_received, quantity_remaining, unit_cost_minor, origin) values ($1, $2, current_date, 1, 1, 1, 'in')`, [org, milk])),
      ).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, (tx) => tx.query(`delete from public.stock_lot_movements`))).rejects.toThrow(/permission denied/);
    }
  });

  it("outra organização, a cozinha sem business.read e anónimos não veem lotes", async () => {
    expect(await lots(milk, rui)).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.stock_lot_movements where organization_id = $1`, [org]))).toHaveLength(0);
    expect(await lots(milk, eva)).toHaveLength(0);
    for (const t of ["stock_lots", "stock_lot_movements", "recipe_productions"]) {
      await expect(asUser(db, null, (tx) => tx.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("unidades", () => {
  it("a conversão da base de dados é igual à do motor para todos os pares de unidades conhecidas", async () => {
    const pairs = KNOWN_UNITS.flatMap((a) => KNOWN_UNITS.map((b) => [a, b] as const));
    const result = await db.query<{ a: string; b: string; r: string | null }>(
      `select x.a, x.b, trim_scale(private.unit_ratio(x.a, x.b))::text as r from jsonb_to_recordset($1::jsonb) as x(a text, b text)`,
      [JSON.stringify(pairs.map(([a, b]) => ({ a, b })))],
    );
    for (const { a, b, r } of result.rows) {
      const engine = unitConversionFactor(a, b);
      // O motor recusa fatores que não são exatos a 3 casas (mg → kg, un → dz); a base de dados converte
      // sempre e arredonda só a quantidade final a 3 casas. Nos restantes, os dois dão o mesmo fator.
      if (engine !== null) expect([a, b, r]).toEqual([a, b, engine]);
      else if (r !== null) expect(Number.isInteger(Math.round(Number(r) * 1e9) / 1e6)).toBe(false);
    }
    expect((await db.query(`select private.unit_ratio('KG', 'g')::int as r`)).rows).toEqual([{ r: 1000 }]);
    expect((await db.query(`select private.unit_ratio('saco', 'saco')::int as r, private.unit_ratio('kg', 'l') as x`)).rows).toEqual([{ r: 1, x: null }]);
  });
});

describe("produção a partir da ficha técnica", () => {
  let recipe: string;
  let flour: string;
  let eggs: string;
  let sugar: string;

  const ingredient = (name: string, quantity: string, unit: string, stockItem: string | null, waste = "0") => ({
    name,
    quantity,
    unit,
    package_quantity: "1000",
    package_price_minor: "100",
    waste_percent: waste,
    cost_minor: "50",
    supplier_price_id: null,
    stock_item_id: stockItem,
  });
  const save = (user: string, items: ReturnType<typeof ingredient>[]) =>
    asUser(db, user, (tx) =>
      tx.query(`select public.save_recipe_content($1, $2::jsonb, $3::jsonb)`, [
        recipe,
        JSON.stringify({
          name: "Bolo",
          portions: "8",
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
  const produce = (user: string, portions: string) =>
    asUser(db, user, (tx) => id(tx, `select public.produce_recipe($1, $2, '2026-11-22', 'Encomenda') as id`, [recipe, portions]));
  const onHand = (item: string) => asUser(db, ana, (tx) => one<{ q: string }>(tx, `select quantity_on_hand::text as q from public.stock_items where id = $1`, [item]));

  beforeAll(async () => {
    flour = await newItem("Farinha", "kg");
    eggs = await newItem("Ovos frescos", "dz");
    sugar = await newItem("Açúcar", "kg");
    await move(flour, { kind: "in", quantity: "5", cost: 90, code: "F1", expires: "2027-02-01" });
    await move(eggs, { kind: "in", quantity: "2", cost: 250, code: "O1", expires: "2026-12-01" });
    await move(sugar, { kind: "in", quantity: "2", cost: 110 });
    recipe = await asUser(db, ana, (tx) => id(tx, `insert into public.recipes (organization_id, name, currency_code, portions) values ($1, 'Bolo', 'EUR', 8) returning id`, [org]));
  });

  it("liga ingredientes a artigos do mesmo âmbito com unidade convertível", async () => {
    await save(ana, [
      ingredient("Farinha", "500", "g", flour),
      ingredient("Ovos", "6", "un", eggs),
      ingredient("Açúcar", "300", "g", sugar, "25"),
      ingredient("Baunilha", "1", "un", null),
    ]);
    expect(await asUser(db, ana, (tx) => rows(tx, `select name, stock_item_id from public.recipe_ingredients where recipe_id = $1 order by position`, [recipe]))).toEqual([
      { name: "Farinha", stock_item_id: flour },
      { name: "Ovos", stock_item_id: eggs },
      { name: "Açúcar", stock_item_id: sugar },
      { name: "Baunilha", stock_item_id: null },
    ]);
    await expect(save(ana, [ingredient("Farinha", "500", "ml", flour)])).rejects.toThrow(/stock_unit_mismatch/);
    const ruiItem = await newItem("Do Rui", "kg", rui, otherOrg);
    await expect(save(ana, [ingredient("Farinha", "500", "g", ruiItem)])).rejects.toThrow(/stock_item_invalid/);
  });

  it("a cozinha sem acesso ao stock não cria ligações novas, mas grava a ficha com as existentes", async () => {
    const current = [
      ingredient("Farinha", "500", "g", flour),
      ingredient("Ovos", "6", "un", eggs),
      ingredient("Açúcar", "300", "g", sugar, "25"),
      ingredient("Baunilha", "1", "un", null),
    ];
    const yeast = await newItem("Fermento", "kg");
    await expect(save(eva, [...current.slice(0, 3), ingredient("Fermento", "10", "g", yeast)])).rejects.toThrow(/stock_item_invalid/);
    await save(eva, current);
  });

  it("produzir dá saída das quantidades com perda e conversão, por FEFO, e fica registado", async () => {
    const production = await produce(ana, "16"); // o dobro da ficha (8 porções)
    expect((await onHand(flour)).q).toBe("4.000"); // 2 × 500 g = 1 kg
    expect((await onHand(eggs)).q).toBe("1.000"); // 2 × 6 un = 12 un = 1 dz
    expect((await onHand(sugar)).q).toBe("1.200"); // 2 × 300 g ÷ 0,75 = 800 g
    const moves = await asUser(db, leo, (tx) =>
      rows(tx, `select i.name, m.kind, m.quantity, m.notes from public.stock_movements m join public.stock_items i on i.id = m.item_id where m.production_id = $1 order by i.name`, [production]),
    );
    expect(moves).toEqual([
      { name: "Açúcar", kind: "out", quantity: "0.800", notes: "Bolo × 16" },
      { name: "Farinha", kind: "out", quantity: "1.000", notes: "Bolo × 16" },
      { name: "Ovos frescos", kind: "out", quantity: "1.000", notes: "Bolo × 16" },
    ]);
    expect(await asUser(db, leo, (tx) => rows(tx, `select recipe_name, portions, occurred_on::text, notes, created_by from public.recipe_productions where id = $1`, [production]))).toEqual([
      { recipe_name: "Bolo", portions: "16.000", occurred_on: "2026-11-22", notes: "Encomenda", created_by: ana },
    ]);
    expect(await remaining(eggs)).toEqual({ O1: "1.000" });
    for (const item of [flour, eggs, sugar]) await assertInvariant(item);
  });

  it("tudo ou nada: sem stock para um ingrediente, nada sai", async () => {
    await expect(produce(ana, "80")).rejects.toThrow(/stock_insufficient/);
    expect((await onHand(flour)).q).toBe("4.000");
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.recipe_productions where portions = 80`))).toHaveLength(0);
  });

  it("recusa porções inválidas e fichas sem ingredientes ligados", async () => {
    await expect(produce(ana, "0")).rejects.toThrow(/quantity_invalid/);
    const empty = await asUser(db, ana, (tx) => id(tx, `insert into public.recipes (organization_id, name, currency_code, portions) values ($1, 'Vazia', 'EUR', 1) returning id`, [org]));
    await expect(asUser(db, ana, (tx) => tx.query(`select public.produce_recipe($1, 1)`, [empty]))).rejects.toThrow(/recipe_no_stock_links/);
  });

  it("só quem lê a ficha e escreve no stock produz; outra organização não", async () => {
    await expect(produce(leo, "1")).rejects.toThrow(/forbidden/);
    await expect(produce(eva, "1")).rejects.toThrow(/forbidden/);
    await expect(produce(rui, "1")).rejects.toThrow(/forbidden/);
    await expect(asUser(db, null, (tx) => tx.query(`select public.produce_recipe($1, 1)`, [recipe]))).rejects.toThrow(/permission denied/);
  });

  it("a ligação à produção não pode ser forjada num movimento comum", async () => {
    const production = (await asUser(db, ana, (tx) => one<{ id: string }>(tx, `select id from public.recipe_productions limit 1`))).id;
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.stock_movements (organization_id, item_id, kind, quantity, production_id) values ($1, $2, 'out', 1, $3)`, [org, flour, production])),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("avisos de validade", () => {
  const mine = (user: string, kind: string) =>
    asUser(db, user, (tx) => rows<{ data: { name: string; code: string | null } }>(tx, `select data from public.notifications where kind = $1 order by data->>'code'`, [kind]));

  it("avisa os lotes que vencem nos próximos dias e os vencidos com quantidade, uma vez", async () => {
    const cream = await newItem("Natas");
    await move(cream, { kind: "in", quantity: "2", cost: 150, code: "N1", expires: "2026-11-25" });
    await move(cream, { kind: "in", quantity: "2", cost: 150, code: "N2", expires: "2026-11-20" });
    await move(cream, { kind: "in", quantity: "2", cost: 150, code: "N3", expires: "2027-06-01" });
    // generate_notifications é privada: corre como na tarefa diária (dono da base de dados).
    await db.query(`select private.generate_notifications('2026-11-22'::date, $1)`, [ana]);
    await db.query(`select private.generate_notifications('2026-11-22'::date, $1)`, [ana]);
    const soon = (await mine(ana, "stock_expiring")).map((r) => r.data.code);
    const past = (await mine(ana, "stock_expired")).map((r) => r.data.code);
    expect(soon).toContain("N1");
    expect(soon).not.toContain("N3");
    expect(past).toContain("N2");
    expect(soon.filter((c) => c === "N1")).toHaveLength(1);
    // O leitor (business.read) também recebe; outra organização e a cozinha sem business.read não.
    await db.query(`select private.generate_notifications('2026-11-22'::date, null)`);
    expect((await mine(leo, "stock_expired")).map((r) => r.data.code)).toContain("N2");
    expect(await mine(rui, "stock_expired")).toHaveLength(0);
    expect(await mine(eva, "stock_expired")).toHaveLength(0);
  });

  it("respeita a antecedência e os tipos desligados nas preferências", async () => {
    await asUser(db, leo, (tx) => tx.query(`insert into public.notification_settings (user_id, disabled_kinds, expiry_soon_days) values ($1, array['stock_expiring'], 30)`, [leo]));
    await asUser(db, leo, (tx) => tx.query(`update public.notification_settings set expiry_soon_days = 60 where user_id = $1`, [leo]));
    await expect(asUser(db, leo, (tx) => tx.query(`update public.notification_settings set expiry_soon_days = 0 where user_id = $1`, [leo]))).rejects.toThrow(/check/);
    await asUser(db, leo, (tx) => tx.query(`delete from public.notifications where kind = 'stock_expiring'`));
    await db.query(`select private.generate_notifications('2026-11-22'::date, $1)`, [leo]);
    expect(await mine(leo, "stock_expiring")).toHaveLength(0);
  });
});
