import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária
let leo: string; // leitor
let rui: string; // outra organização
let org: string;
let otherOrg: string;
let account: string;
let client: string;
let supplier: string;
let ruiSupplier: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@crm.pt");
  leo = await createUser(db, "leo@crm.pt");
  rui = await createUser(db, "rui@crm.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Obras Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  otherOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  const token = await asUser(db, ana, async (tx) => {
    const r = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@crm.pt', $2)`, [org, r])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
  [account, client, supplier] = await asUser(db, ana, async (tx) => [
    await id(tx, `insert into public.financial_accounts (organization_id, name, kind, currency_code) values ($1, 'Banco', 'checking', 'EUR') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Maria Costa') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Materiais SA') returning id`, [org]),
  ]);
  ruiSupplier = await asUser(db, rui, (tx) =>
    id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'supplier', 'Fornecedor do Rui') returning id`, [otherOrg]),
  );
});

describe("observações datadas", () => {
  let note: string;

  it("a proprietária regista uma chamada; o leitor lê mas não escreve", async () => {
    note = await asUser(db, ana, (tx) =>
      id(tx, `insert into public.contact_notes (organization_id, contact_id, kind, noted_on, body) values ($1, $2, 'call', '2026-11-10', 'Pediu orçamento para a cozinha') returning id`, [org, client]),
    );
    const read = await asUser(db, leo, (tx) => rows(tx, `select body, created_by from public.contact_notes where contact_id = $1`, [client]));
    expect(read).toEqual([{ body: "Pediu orçamento para a cozinha", created_by: ana }]);
    await expect(
      asUser(db, leo, (tx) => tx.query(`insert into public.contact_notes (organization_id, contact_id, body) values ($1, $2, 'x')`, [org, client])),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.contact_notes set body = 'y' where id = $1 returning id`, [note]))).toHaveLength(0);
    expect(await asUser(db, leo, (tx) => rows(tx, `delete from public.contact_notes where id = $1 returning id`, [note]))).toHaveLength(0);
  });

  it("outra organização e anónimos não veem nem escrevem", async () => {
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.contact_notes`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `delete from public.contact_notes where id = $1 returning id`, [note]))).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.contact_notes`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.contact_notes (organization_id, contact_id, body) values ($1, $2, 'x')`, [org, client])),
    ).rejects.toThrow(/row-level security/);
  });

  it("não aceita o contacto de outra organização nem mudar de contacto", async () => {
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.contact_notes (organization_id, contact_id, body) values ($1, $2, 'x')`, [otherOrg, client])),
    ).rejects.toThrow(/contact_invalid/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.contact_notes set contact_id = $1 where id = $2`, [supplier, note])),
    ).rejects.toThrow(/permission denied/);
  });

  it("edita o texto e apaga com o contacto", async () => {
    const tmp = await asUser(db, ana, async (tx) => {
      const c = await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Temporário') returning id`, [org]);
      await tx.query(`insert into public.contact_notes (organization_id, contact_id, body) values ($1, $2, 'nota')`, [org, c]);
      await tx.query(`update public.contact_notes set body = 'Reunião confirmada', kind = 'meeting' where id = $1`, [note]);
      await tx.query(`delete from public.contacts where id = $1`, [c]);
      return c;
    });
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.contact_notes where contact_id = $1`, [tmp]))).toHaveLength(0);
    expect(await asUser(db, ana, (tx) => rows(tx, `select kind, body from public.contact_notes where id = $1`, [note]))).toEqual([
      { kind: "meeting", body: "Reunião confirmada" },
    ]);
  });
});

describe("histórico de preços por fornecedor", () => {
  let price: string;
  let expense: string;

  it("regista preços de um fornecedor e liga à despesa que os comprova", async () => {
    [expense, price] = await asUser(db, ana, async (tx) => {
      const e = await id(tx, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, contact_id) values ($1, $2, 'expense', 12000, 'EUR', '2026-11-05', 'Cimento', $3) returning id`, [org, account, supplier]);
      const p = await id(tx, `insert into public.supplier_prices (organization_id, contact_id, item_name, unit, unit_price_minor, currency_code, observed_on, transaction_id) values ($1, $2, '  Cimento 25 kg ', 'saco', 600, 'EUR', '2026-11-05', $3) returning id`, [org, supplier, e]);
      return [e, p];
    });
    const saved = await asUser(db, leo, (tx) => rows(tx, `select item_name, unit_price_minor, transaction_id from public.supplier_prices where id = $1`, [price]));
    expect(saved).toEqual([{ item_name: "Cimento 25 kg", unit_price_minor: 600, transaction_id: expense }]);
  });

  it("só para fornecedores, com moeda e despesa coerentes", async () => {
    const insert = (contact: string, currency = "EUR", tx: string | null = null) =>
      asUser(db, ana, (t) =>
        t.query(`insert into public.supplier_prices (organization_id, contact_id, item_name, unit_price_minor, currency_code, observed_on, transaction_id) values ($1, $2, 'Areia', 100, $3, '2026-11-06', $4)`, [org, contact, currency, tx]),
      );
    await expect(insert(client)).rejects.toThrow(/contact_invalid/);
    await expect(insert(supplier, "BRL", expense)).rejects.toThrow(/transaction_invalid/);
    const income = await asUser(db, ana, (t) =>
      id(t, `insert into public.transactions (organization_id, account_id, kind, amount_minor, currency_code, occurred_on, description, contact_id) values ($1, $2, 'income', 100, 'EUR', '2026-11-06', 'Venda', $3) returning id`, [org, account, client]),
    );
    await expect(insert(supplier, "EUR", income)).rejects.toThrow(/transaction_invalid/);
    await expect(insert(supplier, "XYZ")).rejects.toThrow();
  });

  it("outra organização e anónimos não veem nem escrevem; o leitor não escreve", async () => {
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.supplier_prices`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `update public.supplier_prices set unit_price_minor = 1 where id = $1 returning id`, [price]))).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.supplier_prices`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.supplier_prices (organization_id, contact_id, item_name, unit_price_minor, currency_code, observed_on) values ($1, $2, 'X', 1, 'EUR', '2026-11-01')`, [otherOrg, supplier])),
    ).rejects.toThrow(/contact_invalid/);
    await expect(
      asUser(db, leo, (tx) => tx.query(`insert into public.supplier_prices (organization_id, contact_id, item_name, unit_price_minor, currency_code, observed_on) values ($1, $2, 'X', 1, 'EUR', '2026-11-01')`, [org, supplier])),
    ).rejects.toThrow(/row-level security/);
    // O Rui não consegue ligar um preço seu a uma despesa da Ana.
    await expect(
      asUser(db, rui, (tx) => tx.query(`insert into public.supplier_prices (organization_id, contact_id, item_name, unit_price_minor, currency_code, observed_on, transaction_id) values ($1, $2, 'X', 1, 'EUR', '2026-11-01', $3)`, [otherOrg, ruiSupplier, expense])),
    ).rejects.toThrow(/transaction_invalid/);
  });

  it("apagar a despesa mantém o preço sem a ligação", async () => {
    await asUser(db, ana, (tx) => tx.query(`delete from public.transactions where id = $1`, [expense]));
    expect(await asUser(db, ana, (tx) => rows(tx, `select transaction_id from public.supplier_prices where id = $1`, [price]))).toEqual([
      { transaction_id: null },
    ]);
  });
});

describe("orçamento ligado ao cliente", () => {
  let quote: string;

  beforeAll(async () => {
    quote = await asUser(db, ana, (tx) =>
      id(tx, `insert into public.quotes (organization_id, number, title, currency_code) values ($1, 'x', 'Cozinha', 'EUR') returning id`, [org]),
    );
  });

  const save = (user: string, contact: string | null, status?: string) =>
    asUser(db, user, async (tx) => {
      await tx.query(
        `select public.save_quote_content($1, jsonb_build_object('title', 'Cozinha', 'client_contact_id', $2::text, 'client_name', 'Maria Costa',
           'margin_percent', '20', 'tax_rate_percent', '0', 'total_cost_minor', '0', 'price_before_tax_minor', '0', 'tax_minor', '0', 'total_minor', '0'), '[]'::jsonb)`,
        [quote, contact],
      );
      if (status) await tx.query(`update public.quotes set status = $1 where id = $2`, [status, quote]);
    });

  it("guarda a ligação a um cliente do mesmo âmbito", async () => {
    await save(ana, client);
    expect(await asUser(db, leo, (tx) => rows(tx, `select id from public.quotes where client_contact_id = $1`, [client]))).toHaveLength(1);
  });

  it("recusa fornecedores e contactos de outra organização", async () => {
    await expect(save(ana, supplier)).rejects.toThrow(/contact_invalid/);
    await expect(save(ana, ruiSupplier)).rejects.toThrow(/contact_invalid/);
  });

  it("depois de aceite, a ligação fica bloqueada; o projeto usa o cliente ligado", async () => {
    await asUser(db, ana, async (tx) => {
      await tx.query(`update public.quotes set status = 'sent' where id = $1`, [quote]);
      await tx.query(`update public.quotes set status = 'accepted' where id = $1`, [quote]);
    });
    const other = await asUser(db, ana, (tx) => id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'both', 'Outro') returning id`, [org]));
    await expect(asUser(db, ana, (tx) => tx.query(`update public.quotes set client_contact_id = $1 where id = $2`, [other, quote]))).rejects.toThrow(/quote_locked/);
    const project = await asUser(db, ana, (tx) => id(tx, `select public.create_project_from_quote($1) as id`, [quote]));
    expect(await asUser(db, ana, (tx) => rows(tx, `select client_contact_id from public.projects where id = $1`, [project]))).toEqual([
      { client_contact_id: client },
    ]);
  });

  it("apagar o cliente não fica bloqueado pelo orçamento aceite", async () => {
    const c = await asUser(db, ana, async (tx) => {
      const tmp = await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Para apagar') returning id`, [org]);
      const q = await id(tx, `insert into public.quotes (organization_id, number, title, currency_code, client_contact_id) values ($1, 'x', 'T', 'EUR', $2) returning id`, [org, tmp]);
      await tx.query(`update public.quotes set status = 'sent' where id = $1`, [q]);
      await tx.query(`update public.quotes set status = 'accepted' where id = $1`, [q]);
      await tx.query(`delete from public.contacts where id = $1`, [tmp]);
      return q;
    });
    expect(await asUser(db, ana, (tx) => rows(tx, `select client_contact_id from public.quotes where id = $1`, [c]))).toEqual([{ client_contact_id: null }]);
  });
});
