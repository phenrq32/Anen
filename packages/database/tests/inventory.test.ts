import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { applyStockMovement } from "@anen/financial-engine";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária
let leo: string; // leitor
let eva: string; // funcionária: business.write sem finance.write
let rui: string; // outra organização
let org: string;
let otherOrg: string;
let account: string;
let brlAccount: string;
let supplier: string;
let supplier2: string;
let client: string;
let ruiItem: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

async function invite(owner: string, orgId: string, email: string, role: string, user: string) {
  const token = await asUser(db, owner, async (tx) => {
    const r = await id(tx, `select id from public.roles where key = $1 and organization_id is null`, [role]);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [orgId, email, r])).token;
  });
  await asUser(db, user, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
}

const newItem = (user: string, name: string, extra: Record<string, unknown> = {}) =>
  asUser(db, user, (tx) => {
    const cols = ["organization_id", "name", "unit", "currency_code", ...Object.keys(extra)];
    const values = [org, name, "kg", "EUR", ...Object.values(extra)];
    return id(tx, `insert into public.stock_items (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, values);
  });

const move = (user: string, item: string, kind: string, quantity: string, cost: number | null = null) =>
  asUser(db, user, (tx) =>
    tx.query(`insert into public.stock_movements (organization_id, item_id, kind, quantity, unit_cost_minor) values ($1, $2, $3, $4, $5)`, [org, item, kind, quantity, cost]),
  );

const stock = (item: string) =>
  asUser(db, ana, (tx) => one<{ quantity_on_hand: string; average_cost_minor: number }>(tx, `select quantity_on_hand, average_cost_minor from public.stock_items where id = $1`, [item]));

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@stock.pt");
  leo = await createUser(db, "leo@stock.pt");
  eva = await createUser(db, "eva@stock.pt");
  rui = await createUser(db, "rui@stock.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Padaria Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  otherOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await invite(ana, org, "leo@stock.pt", "viewer", leo);
  await invite(ana, org, "eva@stock.pt", "employee", eva);
  [account, brlAccount, supplier, supplier2, client] = await asUser(db, ana, async (tx) => [
    await id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org]),
    await id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Real', 'checking', 'BRL') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name, payment_terms_days) values ($1, 'supplier', 'Moagem Central', 30) returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'both', 'Grossista Norte') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Café Azul') returning id`, [org]),
  ]);
  ruiItem = await asUser(db, rui, (tx) =>
    id(tx, `insert into public.stock_items (organization_id, name, unit, currency_code) values ($1, 'Do Rui', 'un', 'EUR') returning id`, [otherOrg]),
  );
});

describe("artigos de stock", () => {
  it("o saldo e o custo começam a zero, mesmo que o cliente envie outros valores", async () => {
    const item = await asUser(db, ana, (tx) =>
      id(tx, `insert into public.stock_items (organization_id, name, unit, currency_code, quantity_on_hand, average_cost_minor) values ($1, '  Farinha   T65 ', 'kg', 'EUR', 999, 999) returning id`, [org]),
    );
    expect(await asUser(db, ana, (tx) => rows(tx, `select name, quantity_on_hand, average_cost_minor, created_by from public.stock_items where id = $1`, [item]))).toEqual([
      { name: "Farinha T65", quantity_on_hand: "0.000", average_cost_minor: 0, created_by: ana },
    ]);
    // Saldo, custo, unidade e moeda não se editam diretamente.
    for (const set of ["quantity_on_hand = 5", "average_cost_minor = 5", "unit = 'g'", "currency_code = 'BRL'"]) {
      await expect(asUser(db, ana, (tx) => tx.query(`update public.stock_items set ${set} where id = $1`, [item]))).rejects.toThrow(/permission denied/);
    }
    await expect(newItem(ana, "farinha t65")).rejects.toThrow(/duplicate key/);
  });

  it("o fornecedor preferido tem de ser um fornecedor da mesma organização", async () => {
    await expect(newItem(ana, "Sal", { preferred_supplier_id: client })).rejects.toThrow(/contact_invalid/);
    const ruiSupplier = await asUser(db, rui, (tx) => id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'X') returning id`, [otherOrg]));
    await expect(newItem(ana, "Sal", { preferred_supplier_id: ruiSupplier })).rejects.toThrow(/contact_invalid/);
    expect(await newItem(ana, "Sal", { preferred_supplier_id: supplier2 })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("o leitor lê mas não escreve; outra organização e anónimos não veem nem escrevem", async () => {
    expect((await asUser(db, leo, (tx) => rows(tx, `select id from public.stock_items`))).length).toBeGreaterThan(0);
    await expect(newItem(leo, "Leite")).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.stock_items set min_quantity = 1 returning id`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.stock_items where organization_id = $1`, [org]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `delete from public.stock_items where organization_id = $1 returning id`, [org]))).toHaveLength(0);
    await expect(newItem(rui, "Intruso")).rejects.toThrow(/row-level security/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.stock_items`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.stock_movements`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.purchase_orders`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.purchase_order_items`))).rejects.toThrow(/permission denied/);
  });
});

describe("movimentos de stock", () => {
  let item: string;

  it("calcula o saldo e o custo médio ponderado como o motor", async () => {
    item = await newItem(ana, "Açúcar");
    let expected = { quantity: "0", averageCostMinor: 0n };
    const steps: [string, string, number | null][] = [
      ["in", "10", 200],
      ["in", "5", 260],
      ["out", "4.5", null],
      ["in", "0.750", 1333],
      ["loss", "1", null],
      ["count", "9", null],
    ];
    for (const [kind, quantity, cost] of steps) {
      await move(ana, item, kind, quantity, cost);
      expected = applyStockMovement(expected, { kind: kind as "in", quantity, unitCostMinor: cost === null ? null : BigInt(cost) });
      const s = await stock(item);
      expect([s.quantity_on_hand, BigInt(s.average_cost_minor)]).toEqual([expected.quantity, expected.averageCostMinor]);
    }
    const history = await asUser(db, leo, (tx) =>
      rows(tx, `select kind, quantity_change, balance_after, unit_cost_minor, created_by from public.stock_movements where item_id = $1 order by created_at`, [item]),
    );
    expect(history.map((h) => (h as { quantity_change: string }).quantity_change)).toEqual(["10.000", "5.000", "-4.500", "0.750", "-1.000", "-1.250"]);
    // Saídas, perdas e contagens ficam valorizadas ao custo médio do momento.
    expect((history[2] as { unit_cost_minor: number }).unit_cost_minor).toBe(220);
    expect((history[0] as { created_by: string }).created_by).toBe(ana);
  });

  it("recusa saldo negativo, quantidades inválidas e entradas sem custo", async () => {
    await expect(move(ana, item, "out", "100")).rejects.toThrow(/stock_insufficient/);
    await expect(move(ana, item, "out", "0")).rejects.toThrow(/quantity_invalid/);
    await expect(move(ana, item, "in", "1")).rejects.toThrow(/amount_invalid/);
    expect((await stock(item)).quantity_on_hand).toBe("9.000");
  });

  it("os movimentos não se editam nem se apagam", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`update public.stock_movements set quantity = 1 where item_id = $1`, [item]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.stock_movements where item_id = $1`, [item]))).rejects.toThrow(/permission denied/);
    // Um artigo com movimentos arquiva-se, não se apaga; arquivado não aceita movimentos.
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.stock_items where id = $1`, [item]))).rejects.toThrow(/stock_item_has_movements/);
    await asUser(db, ana, (tx) => tx.query(`update public.stock_items set archived_at = now() where id = $1`, [item]));
    await expect(move(ana, item, "in", "1", 100)).rejects.toThrow(/stock_item_invalid/);
    await asUser(db, ana, (tx) => tx.query(`update public.stock_items set archived_at = null where id = $1`, [item]));
  });

  it("o leitor não regista; outra organização não move artigos alheios", async () => {
    await expect(move(leo, item, "in", "1", 100)).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.stock_movements (organization_id, item_id, kind, quantity, unit_cost_minor) values ($1, $2, 'in', 1, 1)`, [otherOrg, item])),
    ).rejects.toThrow(/stock_item_invalid/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.stock_movements (organization_id, item_id, kind, quantity, unit_cost_minor) values ($1, $2, 'in', 1, 1)`, [org, ruiItem])),
    ).rejects.toThrow(/stock_item_invalid/);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.stock_movements where item_id = $1`, [item]))).toHaveLength(0);
  });
});

describe("encomendas a fornecedores", () => {
  let flour: string;
  let order: string;

  const newOrder = (user: string, supplierId = supplier, currency = "EUR") =>
    asUser(db, user, (tx) => id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code) values ($1, $2, $3) returning id`, [org, supplierId, currency]));
  const addLine = (user: string, orderId: string, description: string, quantity: string, price: number, stockItem: string | null = null) =>
    asUser(db, user, (tx) =>
      tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit, unit_price_minor) values ($1, $2, $3, $4, 'saco', $5)`, [orderId, stockItem, description, quantity, price]),
    );
  const orderRow = (orderId: string) =>
    asUser(db, ana, (tx) => one<{ status: string; total_minor: number; transaction_id: string | null; received_on: string | null }>(tx, `select status, total_minor, transaction_id, received_on::text from public.purchase_orders where id = $1`, [orderId]));

  it("o total é mantido pelo servidor e a linha com artigo usa a unidade do artigo", async () => {
    flour = await newItem(ana, "Farinha T55");
    order = await newOrder(ana);
    await addLine(ana, order, "Farinha T55", "25", 95, flour);
    await addLine(ana, order, "Fermento", "2.5", 333);
    expect((await orderRow(order)).total_minor).toBe(25 * 95 + 833); // 2,5 × 3,33 = 8,325 → 8,33
    const lines = await asUser(db, ana, (tx) => rows(tx, `select unit, total_minor from public.purchase_order_items where order_id = $1 order by description`, [order]));
    expect(lines).toEqual([{ unit: "kg", total_minor: 2375 }, { unit: "saco", total_minor: 833 }]);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set total_minor = 1 where id = $1`, [order]))).rejects.toThrow(/permission denied/);
  });

  it("fornecedor, artigo e projeto coerentes", async () => {
    await expect(newOrder(ana, client)).rejects.toThrow(/contact_invalid/);
    await expect(asUser(db, ana, (tx) => tx.query(`insert into public.purchase_orders (organization_id, currency_code) values ($1, 'EUR')`, [org]))).rejects.toThrow(/contact_invalid/);
    const brl = await newOrder(ana, supplier, "BRL");
    await expect(addLine(ana, brl, "Farinha", "1", 1, flour)).rejects.toThrow(/stock_item_invalid/);
    await expect(addLine(ana, order, "Do Rui", "1", 1, ruiItem)).rejects.toThrow(/stock_item_invalid/);
    const project = await asUser(db, ana, (tx) => id(tx, `insert into public.projects (organization_id, name, currency_code) values ($1, 'Obra', 'BRL') returning id`, [org]));
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set project_id = $1 where id = $2`, [project, order]))).rejects.toThrow(/project_invalid/);
  });

  it("estados: rascunho → encomendada; 'recebida' só pela receção", async () => {
    await asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set status = 'ordered' where id = $1`, [order]));
    expect((await orderRow(order)).status).toBe("ordered");
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set status = 'received' where id = $1`, [order]))).rejects.toThrow(/purchase_status_invalid/);
    // Encomenda enviada ao fornecedor não se apaga (cancela-se).
    expect(await asUser(db, ana, (tx) => rows(tx, `delete from public.purchase_orders where id = $1 returning id`, [order]))).toHaveLength(0);
  });

  it("o leitor e outra organização não mexem nas encomendas nem nas linhas", async () => {
    expect(await asUser(db, leo, (tx) => rows(tx, `select id from public.purchase_order_items where order_id = $1`, [order]))).toHaveLength(2);
    await expect(addLine(leo, order, "x", "1", 1)).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.purchase_order_items set quantity = 9 where order_id = $1 returning id`, [order]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.purchase_order_items where order_id = $1`, [order]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.purchase_orders where id = $1`, [order]))).toHaveLength(0);
    await expect(addLine(rui, order, "x", "1", 1)).rejects.toThrow(/row-level security/);
    await expect(asUser(db, leo, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-20')`, [order]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, rui, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-20')`, [order]))).rejects.toThrow(/forbidden/);
  });

  it("receber cria a entrada de stock, os preços do fornecedor e a despesa a pagar", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-20', $2)`, [order, brlAccount]))).rejects.toThrow(/account_invalid/);
    const tx = await asUser(db, ana, (t) =>
      one<{ id: string }>(t, `select public.receive_purchase_order($1, '2026-11-20', $2, false, 'Compra Moagem Central') as id`, [order, account]),
    );
    expect(await orderRow(order)).toMatchObject({ status: "received", transaction_id: tx.id, received_on: "2026-11-20" });
    expect(await stock(flour)).toEqual({ quantity_on_hand: "25.000", average_cost_minor: 95 });
    const expense = await asUser(db, ana, (t) =>
      rows(t, `select kind, amount_minor, settled_minor, due_on::text, contact_id, description from public.transactions where id = $1`, [tx.id]),
    );
    expect(expense).toEqual([{ kind: "expense", amount_minor: 3208, settled_minor: 0, due_on: "2026-12-20", contact_id: supplier, description: "Compra Moagem Central" }]);
    const prices = await asUser(db, ana, (t) =>
      rows(t, `select item_name, unit, unit_price_minor, observed_on::text, transaction_id from public.supplier_prices where contact_id = $1 order by item_name`, [supplier]),
    );
    expect(prices).toEqual([
      { item_name: "Farinha T55", unit: "kg", unit_price_minor: 95, observed_on: "2026-11-20", transaction_id: tx.id },
      { item_name: "Fermento", unit: "saco", unit_price_minor: 333, observed_on: "2026-11-20", transaction_id: tx.id },
    ]);
    const movement = await asUser(db, ana, (t) => rows(t, `select kind, purchase_order_id from public.stock_movements where item_id = $1`, [flour]));
    expect(movement).toEqual([{ kind: "in", purchase_order_id: order }]);
  });

  it("depois de recebida fica bloqueada", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-21')`, [order]))).rejects.toThrow(/purchase_status_invalid/);
    await expect(addLine(ana, order, "Mais", "1", 1)).rejects.toThrow(/purchase_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_order_items set quantity = 1 where order_id = $1`, [order]))).rejects.toThrow(/purchase_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.purchase_order_items where order_id = $1`, [order]))).rejects.toThrow(/purchase_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set notes = 'x' where id = $1`, [order]))).rejects.toThrow(/purchase_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set status = 'cancelled' where id = $1`, [order]))).rejects.toThrow(/purchase_status_invalid/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.purchase_orders set supplier_id = null, status = 'draft' where id = $1`, [order]))).rejects.toThrow(/purchase_status_invalid|purchase_locked/);
  });

  it("sem finance.write recebe-se sem despesa; com conta é recusado", async () => {
    const o = await newOrder(eva, supplier2);
    await addLine(eva, o, "Farinha T55", "10", 110, flour);
    await expect(asUser(db, eva, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-21', $2)`, [o, account]))).rejects.toThrow(/forbidden/);
    const tx = await asUser(db, eva, (t) => one<{ id: string | null }>(t, `select public.receive_purchase_order($1, '2026-11-21') as id`, [o]));
    expect(tx.id).toBeNull();
    // (25 × 0,95 + 10 × 1,10) / 35 = 0,9928… → 0,99
    expect(await stock(flour)).toEqual({ quantity_on_hand: "35.000", average_cost_minor: 99 });
    const empty = await newOrder(ana);
    await expect(asUser(db, ana, (t) => t.query(`select public.receive_purchase_order($1, '2026-11-21')`, [empty]))).rejects.toThrow(/purchase_empty/);
    expect(await asUser(db, ana, (t) => rows(t, `delete from public.purchase_orders where id = $1 returning id`, [empty]))).toHaveLength(1);
  });
});

describe("reposição abaixo do mínimo", () => {
  it("sugere até ao nível de reposição, desconta o que já está encomendado e cria rascunhos por fornecedor", async () => {
    const [oil, salt2, eggs] = [
      await newItem(ana, "Azeite", { min_quantity: 10, target_quantity: 30, preferred_supplier_id: supplier2 }),
      await newItem(ana, "Sal fino", { min_quantity: 5 }),
      await newItem(ana, "Ovos", { min_quantity: 12, preferred_supplier_id: supplier }),
    ];
    await move(ana, oil, "in", "4", 500);
    // Ovos: já há uma encomenda por receber com 5.
    const pending = await asUser(db, ana, (tx) => id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code) values ($1, $2, 'EUR') returning id`, [org, supplier]));
    await asUser(db, ana, (tx) => tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit_price_minor) values ($1, $2, 'Ovos', 5, 20)`, [pending, eggs]));

    const suggestions = await asUser(db, leo, (tx) =>
      rows(tx, `select item_name, quantity_on_hand, open_quantity, suggested_quantity, supplier_name from public.stock_reorder_suggestions($1) order by item_name`, [org]),
    );
    expect(suggestions).toEqual([
      { item_name: "Azeite", quantity_on_hand: "4.000", open_quantity: "0", suggested_quantity: "26.000", supplier_name: "Grossista Norte" },
      { item_name: "Ovos", quantity_on_hand: "0.000", open_quantity: "5.000", suggested_quantity: "7.000", supplier_name: "Moagem Central" },
      { item_name: "Sal fino", quantity_on_hand: "0.000", open_quantity: "0", suggested_quantity: "5.000", supplier_name: null },
    ]);
    // Outra organização não vê as sugestões; o leitor não cria rascunhos.
    expect(await asUser(db, rui, (tx) => rows(tx, `select * from public.stock_reorder_suggestions($1)`, [org]))).toHaveLength(0);
    await expect(asUser(db, leo, (tx) => tx.query(`select public.create_reorder_drafts($1)`, [org]))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, rui, (tx) => tx.query(`select public.create_reorder_drafts($1)`, [org]))).rejects.toThrow(/forbidden/);

    const result = await asUser(db, ana, (tx) => one<{ r: unknown }>(tx, `select public.create_reorder_drafts($1) as r`, [org]));
    expect(result.r).toEqual({ orders: 2, lines: 2, skipped: 1 });
    const drafts = await asUser(db, ana, (tx) =>
      rows(tx, `select c.name, i.description, i.quantity, i.unit_price_minor from public.purchase_orders o join public.contacts c on c.id = o.supplier_id join public.purchase_order_items i on i.order_id = o.id where o.status = 'draft' and o.id <> $1 order by c.name`, [pending]),
    );
    expect(drafts).toEqual([
      { name: "Grossista Norte", description: "Azeite", quantity: "26.000", unit_price_minor: 0 },
      { name: "Moagem Central", description: "Ovos", quantity: "7.000", unit_price_minor: 0 },
    ]);
    // Já está tudo encomendado: nada de novo.
    expect((await asUser(db, ana, (tx) => one<{ r: unknown }>(tx, `select public.create_reorder_drafts($1) as r`, [org]))).r).toEqual({ orders: 0, lines: 0, skipped: 1 });
  });

  it("o último preço pago vem da última encomenda recebida desse fornecedor", async () => {
    const butter = await newItem(ana, "Manteiga", { min_quantity: 2 });
    const o = await asUser(db, ana, (tx) => id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code) values ($1, $2, 'EUR') returning id`, [org, supplier2]));
    await asUser(db, ana, (tx) => tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit_price_minor) values ($1, $2, 'Manteiga', 1, 450)`, [o, butter]));
    await asUser(db, ana, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-21')`, [o]));
    const s = await asUser(db, ana, (tx) => rows(tx, `select supplier_name, last_unit_price_minor, suggested_quantity from public.stock_reorder_suggestions($1) where item_name = 'Manteiga'`, [org]));
    expect(s).toEqual([{ supplier_name: "Grossista Norte", last_unit_price_minor: 450, suggested_quantity: "1.000" }]);
  });

  it("âmbito pessoal: cada pessoa só vê o seu", async () => {
    const mine = await asUser(db, rui, async (tx) => {
      const s = await id(tx, `insert into public.contacts (owner_user_id, kind, name) values ($1, 'supplier', 'Loja') returning id`, [rui]);
      return id(tx, `insert into public.stock_items (owner_user_id, name, unit, currency_code, min_quantity, preferred_supplier_id) values ($1, 'Café', 'kg', 'EUR', 1, $2) returning id`, [rui, s]);
    });
    expect(await asUser(db, rui, (tx) => rows(tx, `select item_id from public.stock_reorder_suggestions()`))).toEqual([{ item_id: mine }]);
    expect(await asUser(db, ana, (tx) => rows(tx, `select item_id from public.stock_reorder_suggestions()`))).toHaveLength(0);
    expect((await asUser(db, rui, (tx) => one<{ r: unknown }>(tx, `select public.create_reorder_drafts() as r`))).r).toEqual({ orders: 1, lines: 1, skipped: 0 });
  });
});

describe("apagamento de conta", () => {
  it("apaga os dados pessoais e mantém os da organização sem o autor", async () => {
    const zoe = await createUser(db, "zoe@stock.pt");
    await invite(ana, org, "zoe@stock.pt", "employee", zoe);
    const orgItem = await newItem(zoe, "Da Zoe");
    await move(zoe, orgItem, "in", "1", 100);
    const orgOrder = await asUser(db, zoe, (tx) => id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code) values ($1, $2, 'EUR') returning id`, [org, supplier]));
    await asUser(db, zoe, (tx) => tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit_price_minor) values ($1, $2, 'Da Zoe', 1, 100)`, [orgOrder, orgItem]));
    await asUser(db, zoe, (tx) => tx.query(`select public.receive_purchase_order($1, '2026-11-21')`, [orgOrder]));
    await asUser(db, zoe, async (tx) => {
      const s = await id(tx, `insert into public.contacts (owner_user_id, kind, name) values ($1, 'supplier', 'Pessoal') returning id`, [zoe]);
      const i = await id(tx, `insert into public.stock_items (owner_user_id, name, unit, currency_code) values ($1, 'Pessoal', 'un', 'EUR') returning id`, [zoe]);
      await tx.query(`insert into public.stock_movements (owner_user_id, item_id, kind, quantity, unit_cost_minor) values ($1, $2, 'in', 1, 1)`, [zoe, i]);
      const o = await id(tx, `insert into public.purchase_orders (owner_user_id, supplier_id, currency_code) values ($1, $2, 'EUR') returning id`, [zoe, s]);
      await tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit_price_minor) values ($1, $2, 'Pessoal', 1, 1)`, [o, i]);
      await tx.query(`select public.receive_purchase_order($1, '2026-11-21')`, [o]);
    });

    await db.query(`delete from auth.users where id = $1`, [zoe]);

    const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
    expect(await count(`select count(*)::int as n from public.stock_items where owner_user_id is not null and name = 'Pessoal'`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.purchase_orders where owner_user_id is not null and status = 'received'`)).toBe(0);
    expect(await count(`select count(*)::int as n from public.stock_items where id = $1 and created_by is null`, [orgItem])).toBe(1);
    expect(await count(`select count(*)::int as n from public.stock_movements where item_id = $1 and created_by is null`, [orgItem])).toBe(2);
    expect(await count(`select count(*)::int as n from public.purchase_orders where id = $1 and status = 'received' and created_by is null`, [orgOrder])).toBe(1);
  });

  it("apagar a organização apaga artigos, movimentos e encomendas", async () => {
    const tmp = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Temporária', 'PT', 'EUR', 'Europe/Lisbon') as id`));
    await asUser(db, rui, async (tx) => {
      const s = await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'F') returning id`, [tmp]);
      const i = await id(tx, `insert into public.stock_items (organization_id, name, unit, currency_code) values ($1, 'A', 'un', 'EUR') returning id`, [tmp]);
      const o = await id(tx, `insert into public.purchase_orders (organization_id, supplier_id, currency_code) values ($1, $2, 'EUR') returning id`, [tmp, s]);
      await tx.query(`insert into public.purchase_order_items (order_id, stock_item_id, description, quantity, unit_price_minor) values ($1, $2, 'A', 2, 10)`, [o, i]);
      await tx.query(`select public.receive_purchase_order($1, '2026-11-21')`, [o]);
    });
    await db.query(`delete from public.organizations where id = $1`, [tmp]);
    expect(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.stock_items where organization_id = $1`, [tmp])).rows[0]!.n)).toBe(0);
  });
});
