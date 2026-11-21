import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Prompt 03 · Fase 6: agente de mercado (migration 1400). Os pedidos HTTP são substituídos por respostas
// reais das fontes, gravadas a 21/11/2026 (pasta fixtures): Eurostat HICP PT (CP0111), IBGE IPCA (7184) e SINAPI.

let db: PGlite;
let ana: string; // proprietária
let leo: string; // leitor
let rui: string; // outra organização
let org: string;

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async <T = Record<string, unknown>>(tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;
const series = async (source: string, code: string) =>
  (await db.query<{ id: string }>(`select s.id from public.market_series s join public.market_sources src on src.id = s.source_id where src.key = $1 and s.code = $2`, [source, code])).rows[0]!.id;
const runAgent = async () => (await db.query<{ r: { observations: number; failed: number; alerts: number } }>(`select private.run_market_agent() as r`)).rows[0]!.r;

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@mkt.pt");
  leo = await createUser(db, "leo@mkt.pt");
  rui = await createUser(db, "rui@mkt.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Tasca Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await asUser(db, rui, (tx) => tx.query(`select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon')`));
  const token = await asUser(db, ana, async (tx) => {
    const viewer = await id(tx, `select id from public.roles where key = 'viewer' and organization_id is null`);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, 'leo@mkt.pt', $2)`, [org, viewer])).token;
  });
  await asUser(db, leo, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));

  // Respostas gravadas, escolhidas pelo endereço pedido; qualquer outro endereço falha como um erro HTTP.
  await db.exec(`create table private.test_http (pattern text primary key, body jsonb not null)`);
  await db.query(`insert into private.test_http values ($1, $2::jsonb), ($3, $4::jsonb), ($5, $6::jsonb)`, [
    "%eurostat%coicop18=CP0111&%",
    fixture("eurostat-hicp-pt-cp0111.json"),
    "%/t/7060/%c315/7184",
    fixture("ibge-ipca-7184.json"),
    "%/t/2296/%",
    fixture("ibge-sinapi.json"),
  ]);
  await db.exec(`
    create or replace function private.market_http_get(p_url text) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare v jsonb;
    begin
      select body into v from private.test_http where p_url like pattern;
      if v is null then raise exception 'http 503: %', p_url; end if;
      return v;
    end; $$;`);
  // Só as três séries com resposta gravada ficam ativas (as outras testam-se à parte).
  await db.exec(`update public.market_series set is_active = false`);
  await db.query(`update public.market_series set is_active = true where id = any($1)`, [
    [await series("eurostat_hicp", "CP0111"), await series("ibge_ipca", "7184"), await series("ibge_sinapi", "m2")],
  ]);
});

describe("catálogo", () => {
  it("tem fontes oficiais com licença e as séries de Portugal e do Brasil", async () => {
    const sources = await asUser(db, ana, (tx) => rows<{ key: string; publisher: string; license: string }>(tx, `select key, publisher, license from public.market_sources order by key`));
    expect(sources.map((s) => s.key)).toEqual(["eurostat_hicp", "ibge_ipca", "ibge_sinapi"]);
    expect(sources.every((s) => s.license.length > 10)).toBe(true);
    const counts = await asUser(db, ana, (tx) =>
      rows<{ country: string; n: number }>(tx, `select src.country, count(*)::int as n from public.market_series s join public.market_sources src on src.id = s.source_id group by 1 order by 1`),
    );
    expect(counts).toEqual([{ country: "BR", n: 18 }, { country: "PT", n: 18 }]);
  });

  it("monta os endereços de recolha dos últimos 24 meses", async () => {
    const urls = await db.query<{ eurostat: string; ipca: string; sinapi: string }>(`
      select private.market_series_url('eurostat_hicp', '{"dataset":"prc_hicp_minr","geo":"PT","coicop18":"CP0111"}') as eurostat,
             private.market_series_url('ibge_ipca', '{"table":"7060","classification":"c315/7184","variables":{"month":"63","year":"2265"}}') as ipca,
             private.market_series_url('ibge_sinapi', '{"table":"2296","variables":{"value":"48","month":"1196","year":"1198"}}') as sinapi`);
    const u = urls.rows[0]!;
    expect(u.eurostat).toMatch(/^https:\/\/ec\.europa\.eu\/eurostat\/api\/dissemination\/statistics\/1\.0\/data\/prc_hicp_minr\?geo=PT&coicop18=CP0111&unit=I25&unit=RCH_M&unit=RCH_A&sinceTimePeriod=\d{4}-\d{2}&lang=en$/);
    expect(u.ipca).toBe("https://apisidra.ibge.gov.br/values/t/7060/n1/all/v/63,2265/p/last%2024/c315/7184");
    expect(u.sinapi).toBe("https://apisidra.ibge.gov.br/values/t/2296/n1/all/v/48,1196,1198/p/last%2024");
  });

  it("anónimos não leem; ninguém com sessão escreve no catálogo nem nas observações", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.market_series`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.market_observations`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.market_observations (series_id, period, value) select id, '2026-01-01', 1 from public.market_series limit 1`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.market_sources set license = 'x'`))).rejects.toThrow(/permission denied/);
  });
});

describe("agente de mercado", () => {
  it("recolhe e guarda o que cada fonte publica, e regista a execução", async () => {
    const result = await runAgent();
    expect(result).toMatchObject({ observations: 10, failed: 0 });
    // Qualquer pessoa com sessão lê as observações (estatística pública), incluindo de outra organização.
    expect(await asUser(db, rui, (tx) => rows(tx, `select period from public.market_observations`))).toHaveLength(10);
    const pt = await db.query(`select period::text, value::text, change_month::text, change_year::text from public.market_observations where series_id = $1 order by period`, [
      await series("eurostat_hicp", "CP0111"),
    ]);
    expect(pt.rows).toEqual([
      { period: "2026-07-01", value: "102.6300", change_month: "0.000", change_year: "2.400" },
      { period: "2026-08-01", value: "102.3100", change_month: "-0.300", change_year: "2.300" },
      { period: "2026-09-01", value: "102.2300", change_month: "-0.100", change_year: "2.300" },
      { period: "2026-10-01", value: "102.1200", change_month: "-0.100", change_year: "1.700" },
    ]);
    const br = await db.query(`select period::text, value, change_month::text, change_year::text from public.market_observations where series_id = $1 order by period desc limit 1`, [
      await series("ibge_ipca", "7184"),
    ]);
    expect(br.rows).toEqual([{ period: "2026-10-01", value: null, change_month: "0.660", change_year: "2.350" }]);
    const m2 = await db.query(`select value::text, change_month::text, change_year::text from public.market_observations where series_id = $1 and period = '2026-10-01'`, [
      await series("ibge_sinapi", "m2"),
    ]);
    expect(m2.rows).toEqual([{ value: "2005.5700", change_month: "0.290", change_year: "6.840" }]);

    const run = await db.query<{ status: string; processed: number; failed: number }>(`select status, processed, failed from public.job_runs where job = 'market_agent' order by id desc limit 1`);
    expect(run.rows).toEqual([{ status: "success", processed: 10, failed: 0 }]);
    const src = await db.query<{ key: string; ok: boolean; last_error: string | null }>(
      `select key, last_success_at is not null as ok, last_error from public.market_sources order by key`,
    );
    expect(src.rows).toEqual([
      { key: "eurostat_hicp", ok: true, last_error: null },
      { key: "ibge_ipca", ok: true, last_error: null },
      { key: "ibge_sinapi", ok: true, last_error: null },
    ]);
  });

  it("é idempotente: voltar a correr atualiza sem duplicar", async () => {
    await runAgent();
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.market_observations`);
    expect(n.rows[0]!.n).toBe(10);
  });

  it("uma série que falha não trava as outras e fica registada", async () => {
    const gas = await series("eurostat_hicp", "CP0452");
    await db.query(`update public.market_series set is_active = true where id = $1`, [gas]);
    const result = await runAgent();
    expect(result).toMatchObject({ observations: 10, failed: 1 });
    const run = await db.query<{ status: string; details: { errors: Array<{ series: string; error: string }> } }>(
      `select status, details from public.job_runs where job = 'market_agent' order by id desc limit 1`,
    );
    expect(run.rows[0]!.status).toBe("partial");
    expect(run.rows[0]!.details.errors).toEqual([expect.objectContaining({ series: "CP0452", error: expect.stringMatching(/http 503/) })]);
    expect((await db.query<{ e: string }>(`select last_error as e from public.market_sources where key = 'eurostat_hicp'`)).rows[0]!.e).toMatch(/^CP0452: http 503/);
    await db.query(`update public.market_series set is_active = false where id = $1`, [gas]);
  });

  it("uma resposta que não é da forma esperada é recusada", async () => {
    await expect(db.query(`select private.market_ingest_eurostat($1, '{"error":[{"status":400}]}'::jsonb)`, [await series("eurostat_hicp", "CP0111")])).rejects.toThrow(
      /market_payload_invalid/,
    );
    await expect(db.query(`select private.market_ingest_sidra($1, '{"x":1}'::jsonb, '{}'::jsonb)`, [await series("ibge_ipca", "7184")])).rejects.toThrow(/market_payload_invalid/);
  });

  it("só administradores da plataforma correm o agente a pedido; os clientes não chamam as funções internas", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select public.run_market_agent_now()`))).rejects.toThrow(/forbidden/);
    await expect(asUser(db, ana, (tx) => tx.query(`select private.run_market_agent()`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, (tx) => tx.query(`select public.run_market_agent_now()`))).rejects.toThrow(/permission denied/);
  });
});

describe("acompanhamento e alertas", () => {
  let flourWatch: string;

  it("cria alertas quando a variação mensal atinge o limiar, sem repetir", async () => {
    const flour = await series("ibge_ipca", "7184"); // +0,66 % em outubro
    const cereal = await series("eurostat_hicp", "CP0111"); // −0,1 % em outubro
    [flourWatch] = await asUser(db, ana, async (tx) => [
      await id(tx, `insert into public.market_watches (organization_id, series_id, threshold_percent) values ($1, $2, 0.5) returning id`, [org, flour]),
      await id(tx, `insert into public.market_watches (organization_id, series_id, threshold_percent) values ($1, $2, 1) returning id`, [org, cereal]),
    ]);
    expect((await runAgent()).alerts).toBe(1);
    expect((await runAgent()).alerts).toBe(0);
    const alerts = await asUser(db, leo, (tx) => rows(tx, `select period::text, change_month::text, threshold_percent::text from public.market_alerts where organization_id = $1`, [org]));
    expect(alerts).toEqual([{ period: "2026-10-01", change_month: "0.660", threshold_percent: "0.500" }]);
  });

  it("o leitor marca como lido mas não cria nem muda acompanhamentos", async () => {
    const alert = await asUser(db, leo, (tx) => id(tx, `update public.market_alerts set read_at = now() where watch_id = $1 returning id`, [flourWatch]));
    expect(alert).toBeTruthy();
    await expect(
      asUser(db, leo, (tx) => tx.query(`insert into public.market_watches (organization_id, series_id) select $1, id from public.market_series limit 1`, [org])),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.market_watches set threshold_percent = 5 where id = $1 returning id`, [flourWatch]))).toHaveLength(0);
    await expect(asUser(db, leo, (tx) => tx.query(`update public.market_alerts set change_month = 9 where watch_id = $1`, [flourWatch]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.market_alerts (organization_id, watch_id, series_id, period, change_month, threshold_percent) select organization_id, id, series_id, '2026-01-01', 1, 1 from public.market_watches limit 1`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("outra organização não vê acompanhamentos nem alertas; a série acompanhada não muda", async () => {
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.market_watches`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.market_alerts`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `delete from public.market_watches where id = $1 returning id`, [flourWatch]))).toHaveLength(0);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.market_watches set series_id = (select id from public.market_series where code = 'TOTAL') where id = $1`, [flourWatch])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.market_watches (organization_id, series_id) select organization_id, series_id from public.market_watches where id = $1`, [flourWatch])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("uma pessoa acompanha séries no âmbito pessoal", async () => {
    const total = await series("ibge_ipca", "7169");
    await asUser(db, rui, (tx) => tx.query(`insert into public.market_watches (owner_user_id, series_id) values ($1, $2)`, [rui, total]));
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.market_watches where owner_user_id = $1`, [rui]))).toHaveLength(0);
    await expect(asUser(db, ana, (tx) => tx.query(`insert into public.market_watches (owner_user_id, series_id) values ($1, $2)`, [rui, total]))).rejects.toThrow(
      /row-level security/,
    );
  });
});
