import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Secções nas linhas do orçamento (migration 3400): agrupar as linhas por serviço.

let db: PGlite;
let ana: string;
let rui: string;
let org: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@seccoes.pt");
  rui = await createUser(db, "rui@seccoes.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Pinturas Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await asUser(db, rui, (tx) => tx.query(`select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon')`));
});

const newQuote = () =>
  asUser(db, ana, (tx) => id(tx, `insert into public.quotes (organization_id, number, title, currency_code) values ($1, 'x', 'Pintura', 'EUR') returning id`, [org]));

const fields = JSON.stringify({
  title: "Pintura",
  margin_percent: "0",
  tax_rate_percent: "0",
  total_cost_minor: "70000",
  price_before_tax_minor: "70000",
  tax_minor: "0",
  total_minor: "70000",
});
const item = (position: number, section: string | null | undefined, description: string) => ({
  position,
  kind: "material",
  nature: "product",
  ...(section === undefined ? {} : { section }),
  description,
  quantity: "1",
  unit: "un",
  unit_cost_minor: "10000",
  total_cost_minor: "10000",
});
const save = (user: string, quote: string, items: unknown[]) =>
  asUser(db, user, (tx) => tx.query(`select public.save_quote_content($1, $2::jsonb, $3::jsonb)`, [quote, fields, JSON.stringify(items)]));

describe("secções nas linhas do orçamento", () => {
  it("grava a secção de cada linha; vazio ou ausente fica sem secção; entra na versão", async () => {
    const q = await newQuote();
    await save(ana, q, [item(0, "Pintura de T2 completo", "Tinta"), item(1, "  ", "Extra"), item(2, undefined, "Deslocação")]);
    const r = await asUser(db, ana, (tx) => tx.query<{ section: string | null; description: string }>(`select section, description from public.quote_items where quote_id = $1 order by position`, [q]));
    expect(r.rows).toEqual([
      { section: "Pintura de T2 completo", description: "Tinta" },
      { section: null, description: "Extra" },
      { section: null, description: "Deslocação" },
    ]);
    const v = await asUser(db, ana, (tx) =>
      one<{ s: string | null }>(tx, `select (snapshot -> 'items' -> 0 ->> 'section') as s from public.quote_versions where quote_id = $1 order by version desc limit 1`, [q]),
    );
    expect(v.s).toBe("Pintura de T2 completo");
  });

  it("recusa secções com mais de 160 caracteres", async () => {
    const q = await newQuote();
    await expect(save(ana, q, [item(0, "x".repeat(161), "Tinta")])).rejects.toThrow(/quote_items_section_check/);
  });

  it("outra organização e anónimos não leem nem gravam secções", async () => {
    const q = await newQuote();
    await save(ana, q, [item(0, "Pintura", "Tinta")]);
    const seen = await asUser(db, rui, (tx) => tx.query(`select section from public.quote_items where quote_id = $1`, [q]));
    expect(seen.rows).toHaveLength(0);
    await expect(save(rui, q, [item(0, "Intruso", "Tinta")])).rejects.toThrow(/forbidden/);
    await expect(asUser(db, null, (tx) => tx.query(`select section from public.quote_items limit 1`))).rejects.toThrow(/permission denied/);
    const after = await asUser(db, ana, (tx) => tx.query<{ section: string }>(`select section from public.quote_items where quote_id = $1`, [q]));
    expect(after.rows).toEqual([{ section: "Pintura" }]);
  });
});
