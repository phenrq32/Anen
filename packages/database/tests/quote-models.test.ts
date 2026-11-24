import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

/** Modelos de orçamento com preços (pacote 2026-11): a base de dados tem exatamente o que o dono da app enviou. */
interface PackService {
  id: string;
  nome: string;
  unidade: string;
  preco_recomendado: number;
  faixa_min: number;
  faixa_max: number;
  materiais: string;
  nota: string;
  composicao: { linha: string; valor: number }[];
}
interface Pack {
  versao: string;
  paises: Record<string, { moeda: string; impostos_inclusos: boolean; categorias: { id: string; servicos: PackService[] }[] }>;
}

const pack = JSON.parse(readFileSync(resolve(__dirname, "../../../data/modelos-orcamento/dados/modelos_orcamento_2026.json"), "utf8")) as Pack;
/** Euros/reais do pacote → cêntimos, por texto (sem vírgula flutuante). */
const minor = (v: number) => {
  const [i, f = ""] = String(v).split(".");
  return Number(BigInt(i!) * 100n + BigInt((f + "00").slice(0, 2)));
};

let db: PGlite;
let ana: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@modelos.pt");
});

describe("modelos de orçamento com preços", () => {
  it("a migration é exatamente a saída do gerador (não foi editada à mão nem ficou desatualizada)", () => {
    const root = resolve(__dirname, "../../..");
    const generated = execFileSync(process.execPath, [resolve(root, "scripts/quote-models/build-migration.mjs")], { encoding: "utf8" });
    const committed = readFileSync(resolve(root, "supabase/migrations/20261124003100_quote_service_models.sql"), "utf8");
    expect(generated === committed).toBe(true);
  });

  it("um conjunto por país, com moeda, impostos e fontes", async () => {
    const sets = await asUser(db, ana, (t) =>
      t.query<{ id: string; currency_code: string; taxes_included: boolean; n: number; suggested_tax_percent: string | null }>(
        `select id, currency_code, taxes_included, cardinality(sources) as n, suggested_tax_percent from public.quote_model_sets order by id`,
      ),
    );
    expect(sets.rows.map((r) => [r.id, r.currency_code, r.taxes_included])).toEqual([
      ["br-2026-11", "BRL", true],
      ["pt-2026-11", "EUR", false],
    ]);
    expect(sets.rows.every((r) => r.n >= 8)).toBe(true);
    expect(sets.rows.find((r) => r.id === "pt-2026-11")?.suggested_tax_percent).toBe("23.000");
    expect(sets.rows.find((r) => r.id === "br-2026-11")?.suggested_tax_percent).toBeNull();
  });

  it("cada serviço do pacote está na base com os mesmos valores, em cêntimos", async () => {
    for (const [code, country] of Object.entries(pack.paises)) {
      const rows = await asUser(db, ana, (t) =>
        t.query<{ service_key: string; name: string; unit: string; recommended_minor: string; range_min_minor: string; range_max_minor: string; materials: string; note: string; composition: { line: string; amount_minor: number }[] }>(
          `select service_key, name, unit, recommended_minor, range_min_minor, range_max_minor, materials, note, composition from public.quote_service_models where set_id = $1`,
          [`${code}-${pack.versao}`],
        ),
      );
      const byKey = new Map(rows.rows.map((r) => [r.service_key, r]));
      const services = country.categorias.flatMap((c) => c.servicos);
      expect(rows.rows).toHaveLength(services.length);
      for (const s of services) {
        const r = byKey.get(s.id);
        expect(r, s.id).toBeDefined();
        expect([r!.name, r!.unit, Number(r!.recommended_minor), Number(r!.range_min_minor), Number(r!.range_max_minor), r!.materials, r!.note]).toEqual([
          s.nome,
          s.unidade,
          minor(s.preco_recomendado),
          minor(s.faixa_min),
          minor(s.faixa_max),
          s.materiais || null, // texto vazio no pacote = sem valor
          s.nota || null,
        ]);
        expect(r!.composition.map((x) => [x.line, x.amount_minor])).toEqual(s.composicao.map((x) => [x.linha, minor(x.valor)]));
      }
    }
  });

  it("Portugal 195 e Brasil 200 serviços; todas as 19 categorias ligadas a um modelo da app", async () => {
    const r = await db.query<{ set_id: string; n: number; t: number }>(
      `select set_id, count(*)::int as n, count(distinct template_key)::int as t from public.quote_service_models group by set_id order by set_id`,
    );
    expect(r.rows).toEqual([
      { set_id: "br-2026-11", n: 200, t: 19 },
      { set_id: "pt-2026-11", n: 195, t: 19 },
    ]);
  });

  it("a base recusa composição que não soma o preço e preço fora da faixa", async () => {
    const insert = (recommended: number, min: number, max: number, composition: string) =>
      db.query(
        `insert into public.quote_service_models (set_id, service_key, category_key, template_key, category_name, name, unit, recommended_minor, range_min_minor, range_max_minor, composition, position)
         values ('pt-2026-11', 'teste__x', 'teste', 'painting', 'Teste', 'X', 'm²', $1, $2, $3, $4::jsonb, 999)`,
        [recommended, min, max, composition],
      );
    await expect(insert(1000, 500, 2000, `[{"line":"Tinta","kind":"material","amount_minor":900}]`)).rejects.toThrow(/quote_model_invalid/);
    await expect(insert(1000, 500, 2000, `[{"line":"Tinta","kind":"magia","amount_minor":1000}]`)).rejects.toThrow(/quote_model_invalid/);
    await expect(insert(1000, 1500, 2000, `[{"line":"Tinta","kind":"material","amount_minor":1000}]`)).rejects.toThrow(/quote_service_models_range/);
  });

  it("só leitura para quem tem sessão; anónimos sem acesso", async () => {
    await expect(asUser(db, null, (t) => t.query(`select 1 from public.quote_service_models limit 1`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (t) => t.query(`select 1 from public.quote_model_sets limit 1`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (t) => t.query(`update public.quote_service_models set recommended_minor = 1`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (t) => t.query(`delete from public.quote_model_sets`))).rejects.toThrow(/permission denied/);
  });
});
