-- Prompt 03 · Fase 6: inteligência de mercado e o agente de mercado.
--
-- Fontes oficiais e abertas, sem chave, verificadas a 21/11/2026:
--   * Eurostat, HICP (prc_hicp_minr, ECOICOP v2): índice 2025 = 100 e taxas mensal e anual, Portugal.
--   * IBGE, IPCA (tabela SIDRA 7060): variação mensal e em 12 meses, Brasil.
--   * IBGE, SINAPI (tabela SIDRA 2296): custo médio do m² da construção (R$) e variações, Brasil.
-- São índices e custos médios oficiais, não preços de produtos concretos. Nada é estimado: guarda-se
-- o que a fonte publica, com a data de recolha. Os preços de combustíveis por posto da DGEG só existem
-- numa API interna do site, sem documentação nem licença, e por isso não são usados.
--
-- O agente de mercado corre no Postgres (pg_cron + extensão http da Supabase), todos os dias:
-- recolhe cada série, guarda as observações, regista a execução em job_runs e cria alertas para quem
-- acompanha uma série. Uma série que falha não trava as outras.

-- ---------------------------------------------------------------------------
-- Catálogo (sistema): fontes e séries
-- ---------------------------------------------------------------------------
create table public.market_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]{2,40}$'),
  name text not null,
  publisher text not null,
  country char(2) not null,
  docs_url text not null,
  license text not null,
  is_active boolean not null default true,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table public.market_series (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.market_sources (id) on delete cascade,
  code text not null check (char_length(code) between 1 and 40),
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('general', 'food', 'energy', 'fuel', 'services', 'construction')),
  -- O que é "value": índice (base indicada), preço médio na moeda indicada, ou nada (só variações).
  value_kind text not null check (value_kind in ('index', 'price', 'none')),
  value_unit text check (char_length(value_unit) <= 40),
  currency_code char(3) references public.currencies (code),
  fetch_spec jsonb not null,
  position smallint not null default 0,
  is_active boolean not null default true,
  unique (source_id, code),
  constraint market_series_price_currency check ((value_kind = 'price') = (currency_code is not null))
);

create table public.market_observations (
  series_id uuid not null references public.market_series (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  value numeric(18, 4),
  change_month numeric(9, 3),
  change_year numeric(9, 3),
  collected_at timestamptz not null default now(),
  primary key (series_id, period)
);

alter table public.market_sources enable row level security;
alter table public.market_series enable row level security;
alter table public.market_observations enable row level security;
-- Estatística oficial pública: legível por quem tem sessão; só o agente escreve.
create policy "read" on public.market_sources for select to authenticated using (true);
create policy "read" on public.market_series for select to authenticated using (true);
create policy "read" on public.market_observations for select to authenticated using (true);
revoke all on public.market_sources, public.market_series, public.market_observations from anon;
revoke insert, update, delete, truncate on public.market_sources, public.market_series, public.market_observations from authenticated;

-- ---------------------------------------------------------------------------
-- Acompanhamento e alertas (por pessoa ou organização, permissões business.*)
-- ---------------------------------------------------------------------------
create table public.market_watches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  series_id uuid not null references public.market_series (id) on delete cascade,
  -- Alerta quando a variação mensal publicada, em valor absoluto, atinge este limiar (pontos percentuais).
  threshold_percent numeric(6, 3) not null default 1 check (threshold_percent > 0 and threshold_percent <= 100),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint market_watches_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index market_watches_org_series_idx on public.market_watches (organization_id, series_id) where organization_id is not null;
create unique index market_watches_owner_series_idx on public.market_watches (owner_user_id, series_id) where owner_user_id is not null;

create table public.market_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  watch_id uuid not null references public.market_watches (id) on delete cascade,
  series_id uuid not null references public.market_series (id) on delete cascade,
  period date not null,
  change_month numeric(9, 3) not null,
  change_year numeric(9, 3),
  threshold_percent numeric(6, 3) not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (watch_id, period),
  constraint market_alerts_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index market_alerts_org_idx on public.market_alerts (organization_id, created_at desc) where organization_id is not null;
create index market_alerts_owner_idx on public.market_alerts (owner_user_id, created_at desc) where owner_user_id is not null;

create trigger market_watches_scope before insert or update on public.market_watches
  for each row execute function private.set_creator_and_lock_scope();

-- A série acompanhada não muda (para mudar, apaga-se e cria-se outra).
create or replace function private.guard_market_watch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.series_id <> old.series_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger market_watches_guard before update on public.market_watches
  for each row execute function private.guard_market_watch();

alter table public.market_watches enable row level security;
alter table public.market_alerts enable row level security;
create policy "business read" on public.market_watches for select to authenticated using (private.can_access_business(organization_id, owner_user_id, false));
create policy "business insert" on public.market_watches for insert to authenticated with check (private.can_access_business(organization_id, owner_user_id, true));
create policy "business update" on public.market_watches for update to authenticated
  using (private.can_access_business(organization_id, owner_user_id, true)) with check (private.can_access_business(organization_id, owner_user_id, true));
create policy "business delete" on public.market_watches for delete to authenticated using (private.can_access_business(organization_id, owner_user_id, true));
-- Alertas: só o agente cria; quem lê marca como lido ou apaga.
create policy "business read" on public.market_alerts for select to authenticated using (private.can_access_business(organization_id, owner_user_id, false));
create policy "business update" on public.market_alerts for update to authenticated
  using (private.can_access_business(organization_id, owner_user_id, false)) with check (private.can_access_business(organization_id, owner_user_id, false));
create policy "business delete" on public.market_alerts for delete to authenticated using (private.can_access_business(organization_id, owner_user_id, true));
revoke all on public.market_watches, public.market_alerts from anon;
revoke truncate on public.market_watches, public.market_alerts from authenticated;
revoke update on public.market_watches from authenticated;
grant update (threshold_percent) on public.market_watches to authenticated;
revoke insert, update on public.market_alerts from authenticated;
grant update (read_at) on public.market_alerts to authenticated;

-- ---------------------------------------------------------------------------
-- O agente de mercado
-- ---------------------------------------------------------------------------

-- Pedido HTTP (extensão http da Supabase). Em SQL dinâmico para a base de dados funcionar sem a
-- extensão (testes locais); nos testes esta função é substituída por uma que devolve respostas reais gravadas.
create or replace function private.market_http_get(p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status integer;
  v_content text;
begin
  execute $q$select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000')$q$;
  execute $q$select status, content from extensions.http((
      'GET', $1, array[extensions.http_header('User-Agent', 'ANEN-market-agent/1.0')], null, null
    )::extensions.http_request)$q$
    into v_status, v_content using p_url;
  if v_status <> 200 then
    raise exception 'http %: %', v_status, left(coalesce(v_content, ''), 200);
  end if;
  return v_content::jsonb;
end;
$$;

-- Endereço de recolha de uma série (últimos 24 meses).
create or replace function private.market_series_url(p_source text, p_fetch jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_source = 'eurostat_hicp' then
    return format(
      'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/%s?geo=%s&coicop18=%s&unit=I25&unit=RCH_M&unit=RCH_A&sinceTimePeriod=%s&lang=en',
      p_fetch ->> 'dataset', p_fetch ->> 'geo', p_fetch ->> 'coicop18', to_char(now() - interval '24 months', 'YYYY-MM'));
  elsif p_source in ('ibge_ipca', 'ibge_sinapi') then
    return format('https://apisidra.ibge.gov.br/values/t/%s/n1/all/v/%s/p/last%%2024%s',
      p_fetch ->> 'table',
      array_to_string(array_remove(array[p_fetch -> 'variables' ->> 'value', p_fetch -> 'variables' ->> 'month', p_fetch -> 'variables' ->> 'year'], null), ','),
      coalesce('/' || (p_fetch ->> 'classification'), ''));
  end if;
  raise exception 'market_source_unknown: %', p_source;
end;
$$;

-- JSON-stat: "value" pode ser um objeto esparso {"índice": valor} ou uma lista densa.
create or replace function private.jsonstat_value(p_values jsonb, p_index integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p_values)
    when 'array' then (p_values ->> p_index)::numeric
    when 'object' then (p_values ->> p_index::text)::numeric
  end;
$$;

-- Eurostat JSON-stat 2.0: valor plano indexado por Σ posição × passo de cada dimensão.
-- Os pedidos fixam todas as dimensões menos a unidade e o tempo.
create or replace function private.market_ingest_eurostat(p_series_id uuid, p_doc jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := array(select jsonb_array_elements_text(p_doc -> 'id'));
  v_sizes integer[] := array(select (jsonb_array_elements_text(p_doc -> 'size'))::integer);
  v_stride_unit integer := 1;
  v_stride_time integer := 1;
  v_unit_pos integer;
  v_time_pos integer;
  v_count integer;
begin
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'market_payload_invalid';
  end if;
  v_unit_pos := array_position(v_ids, 'unit');
  v_time_pos := array_position(v_ids, 'time');
  if v_unit_pos is null or v_time_pos is null then
    raise exception 'market_payload_invalid';
  end if;
  for i in v_unit_pos + 1 .. array_length(v_sizes, 1) loop v_stride_unit := v_stride_unit * v_sizes[i]; end loop;
  for i in v_time_pos + 1 .. array_length(v_sizes, 1) loop v_stride_time := v_stride_time * v_sizes[i]; end loop;

  with times as (
    select t.key as period, t.value::integer as pos from jsonb_each_text(p_doc -> 'dimension' -> 'time' -> 'category' -> 'index') t
  ), units as (
    select u.key as unit, u.value::integer as pos from jsonb_each_text(p_doc -> 'dimension' -> 'unit' -> 'category' -> 'index') u
  ), cells as (
    select times.period,
           max(case when units.unit = 'I25' then private.jsonstat_value(p_doc -> 'value', units.pos * v_stride_unit + times.pos * v_stride_time) end) as value,
           max(case when units.unit = 'RCH_M' then private.jsonstat_value(p_doc -> 'value', units.pos * v_stride_unit + times.pos * v_stride_time) end) as change_month,
           max(case when units.unit = 'RCH_A' then private.jsonstat_value(p_doc -> 'value', units.pos * v_stride_unit + times.pos * v_stride_time) end) as change_year
    from times cross join units
    group by times.period
  ), upserted as (
    insert into public.market_observations (series_id, period, value, change_month, change_year, collected_at)
    select p_series_id, to_date(period || '-01', 'YYYY-MM-DD'), value, change_month, change_year, now()
    from cells
    where value is not null or change_month is not null or change_year is not null
    on conflict (series_id, period) do update set
      value = excluded.value, change_month = excluded.change_month, change_year = excluded.change_year, collected_at = excluded.collected_at
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;

-- IBGE SIDRA: lista de linhas (a primeira é o cabeçalho); D2C = variável, D3C = mês AAAAMM, V = valor
-- ("...", "-" ou "X" quando não há valor publicado).
create or replace function private.market_ingest_sidra(p_series_id uuid, p_doc jsonb, p_variables jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_doc) <> 'array' then
    raise exception 'market_payload_invalid';
  end if;
  with rows as (
    select r ->> 'D2C' as variable, r ->> 'D3C' as month,
           case when (r ->> 'V') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r ->> 'V')::numeric end as v
    from jsonb_array_elements(p_doc) with ordinality as x(r, n)
    where n > 1 and (r ->> 'D3C') ~ '^[0-9]{6}$'
  ), cells as (
    select month,
           max(case when variable = p_variables ->> 'value' then v end) as value,
           max(case when variable = p_variables ->> 'month' then v end) as change_month,
           max(case when variable = p_variables ->> 'year' then v end) as change_year
    from rows group by month
  ), upserted as (
    insert into public.market_observations (series_id, period, value, change_month, change_year, collected_at)
    select p_series_id, to_date(month || '01', 'YYYYMMDD'), value, change_month, change_year, now()
    from cells
    where value is not null or change_month is not null or change_year is not null
    on conflict (series_id, period) do update set
      value = excluded.value, change_month = excluded.change_month, change_year = excluded.change_year, collected_at = excluded.collected_at
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;

-- Alertas: a última observação de cada série acompanhada, quando |variação mensal| ≥ limiar. Idempotente.
create or replace function private.market_generate_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with created as (
    insert into public.market_alerts (organization_id, owner_user_id, watch_id, series_id, period, change_month, change_year, threshold_percent)
    select w.organization_id, w.owner_user_id, w.id, w.series_id, o.period, o.change_month, o.change_year, w.threshold_percent
    from public.market_watches w
    cross join lateral (
      select * from public.market_observations o where o.series_id = w.series_id order by o.period desc limit 1
    ) o
    where o.change_month is not null and abs(o.change_month) >= w.threshold_percent
    on conflict (watch_id, period) do nothing
    returning 1
  )
  select count(*) into v_count from created;
  return v_count;
end;
$$;

create or replace function private.run_market_agent()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_series record;
  v_doc jsonb;
  v_n integer;
  v_processed integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_alerts integer := 0;
  v_result jsonb;
begin
  insert into public.job_runs (job) values ('market_agent') returning id into v_run;
  for v_series in
    select s.id, s.code, s.fetch_spec, src.key as source, src.id as source_id
    from public.market_series s join public.market_sources src on src.id = s.source_id
    where s.is_active and src.is_active
    order by src.key, s.position
  loop
    begin
      v_doc := private.market_http_get(private.market_series_url(v_series.source, v_series.fetch_spec));
      if v_series.source = 'eurostat_hicp' then
        v_n := private.market_ingest_eurostat(v_series.id, v_doc);
      else
        v_n := private.market_ingest_sidra(v_series.id, v_doc, v_series.fetch_spec -> 'variables');
      end if;
      if v_n = 0 then
        raise exception 'market_no_data';
      end if;
      v_processed := v_processed + v_n;
      update public.market_sources set last_run_at = now(), last_success_at = now(), last_error = null where id = v_series.source_id;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('source', v_series.source, 'series', v_series.code, 'error', left(sqlerrm, 300));
      update public.market_sources set last_run_at = now(), last_error = left(v_series.code || ': ' || sqlerrm, 300) where id = v_series.source_id;
    end;
  end loop;
  begin
    v_alerts := private.market_generate_alerts();
  exception when others then
    v_errors := v_errors || jsonb_build_object('step', 'alerts', 'error', left(sqlerrm, 300));
    v_failed := v_failed + 1;
  end;
  v_result := jsonb_build_object('observations', v_processed, 'failed', v_failed, 'alerts', v_alerts, 'errors', v_errors);
  update public.job_runs set
    finished_at = now(), processed = v_processed, failed = v_failed,
    status = case when v_failed = 0 then 'success' when v_processed > 0 then 'partial' else 'error' end,
    details = v_result
  where id = v_run;
  return v_result;
end;
$$;

-- Execução manual, só para administradores da plataforma (ex.: primeira recolha depois de publicar).
create or replace function public.run_market_agent_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.run_market_agent();
end;
$$;

revoke all on function private.jsonstat_value(jsonb, integer), private.market_http_get(text), private.market_series_url(text, jsonb), private.market_ingest_eurostat(uuid, jsonb),
  private.market_ingest_sidra(uuid, jsonb, jsonb), private.market_generate_alerts(), private.run_market_agent(), private.guard_market_watch() from public;
revoke all on function public.run_market_agent_now() from public, anon;
grant execute on function public.run_market_agent_now() to authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo inicial
-- ---------------------------------------------------------------------------
insert into public.market_sources (key, name, publisher, country, docs_url, license) values
  ('eurostat_hicp', 'Índice harmonizado de preços no consumidor (HICP)', 'Eurostat', 'PT',
   'https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table',
   'Reutilização livre com indicação da fonte (Eurostat, CC BY 4.0)'),
  ('ibge_ipca', 'Índice Nacional de Preços ao Consumidor Amplo (IPCA)', 'IBGE', 'BR',
   'https://sidra.ibge.gov.br/tabela/7060',
   'Dados públicos do IBGE; reutilização com citação da fonte'),
  ('ibge_sinapi', 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)', 'IBGE', 'BR',
   'https://sidra.ibge.gov.br/tabela/2296',
   'Dados públicos do IBGE; reutilização com citação da fonte');

insert into public.market_series (source_id, code, name, category, value_kind, value_unit, currency_code, fetch_spec, position)
select src.id, s.code, s.name, s.category, s.value_kind, s.value_unit, s.currency_code,
       case when src.key = 'eurostat_hicp' then jsonb_build_object('dataset', 'prc_hicp_minr', 'geo', 'PT', 'coicop18', s.code)
            when src.key = 'ibge_ipca' then jsonb_build_object('table', '7060', 'classification', 'c315/' || s.code, 'variables', jsonb_build_object('month', '63', 'year', '2265'))
            else jsonb_build_object('table', '2296', 'variables', jsonb_build_object('value', '48', 'month', '1196', 'year', '1198')) end,
       s.position
from (values
  ('eurostat_hicp', 'TOTAL', 'Índice geral', 'general', 'index', '2025 = 100', null, 0),
  ('eurostat_hicp', 'CP01', 'Alimentação e bebidas não alcoólicas', 'food', 'index', '2025 = 100', null, 10),
  ('eurostat_hicp', 'CP0111', 'Cereais e produtos à base de cereais', 'food', 'index', '2025 = 100', null, 11),
  ('eurostat_hicp', 'CP0112', 'Carne', 'food', 'index', '2025 = 100', null, 12),
  ('eurostat_hicp', 'CP0113', 'Peixe e marisco', 'food', 'index', '2025 = 100', null, 13),
  ('eurostat_hicp', 'CP0114', 'Leite, laticínios e ovos', 'food', 'index', '2025 = 100', null, 14),
  ('eurostat_hicp', 'CP0115', 'Óleos e gorduras', 'food', 'index', '2025 = 100', null, 15),
  ('eurostat_hicp', 'CP0116', 'Frutas e frutos secos', 'food', 'index', '2025 = 100', null, 16),
  ('eurostat_hicp', 'CP0117', 'Legumes, tubérculos e leguminosas', 'food', 'index', '2025 = 100', null, 17),
  ('eurostat_hicp', 'CP0118', 'Açúcar, confeitaria e sobremesas', 'food', 'index', '2025 = 100', null, 18),
  ('eurostat_hicp', 'CP0122', 'Café', 'food', 'index', '2025 = 100', null, 19),
  ('eurostat_hicp', 'CP1111', 'Restaurantes, cafés e similares', 'services', 'index', '2025 = 100', null, 30),
  ('eurostat_hicp', 'CP0451', 'Eletricidade', 'energy', 'index', '2025 = 100', null, 40),
  ('eurostat_hicp', 'CP0452', 'Gás', 'energy', 'index', '2025 = 100', null, 41),
  ('eurostat_hicp', 'CP07221', 'Gasóleo', 'fuel', 'index', '2025 = 100', null, 50),
  ('eurostat_hicp', 'CP07222', 'Gasolina', 'fuel', 'index', '2025 = 100', null, 51),
  ('eurostat_hicp', 'CP0431', 'Materiais para manutenção e reparação da habitação', 'construction', 'index', '2025 = 100', null, 60),
  ('eurostat_hicp', 'CP0432', 'Serviços de manutenção e reparação da habitação', 'construction', 'index', '2025 = 100', null, 61),
  ('ibge_ipca', '7169', 'Índice geral', 'general', 'none', null, null, 0),
  ('ibge_ipca', '7170', 'Alimentação e bebidas', 'food', 'none', null, null, 10),
  ('ibge_ipca', '7171', 'Alimentação no domicílio', 'food', 'none', null, null, 11),
  ('ibge_ipca', '7172', 'Cereais, leguminosas e oleaginosas', 'food', 'none', null, null, 12),
  ('ibge_ipca', '7184', 'Farinhas, féculas e massas', 'food', 'none', null, null, 13),
  ('ibge_ipca', '7283', 'Carnes', 'food', 'none', null, null, 14),
  ('ibge_ipca', '7303', 'Pescados', 'food', 'none', null, null, 15),
  ('ibge_ipca', '7349', 'Aves e ovos', 'food', 'none', null, null, 16),
  ('ibge_ipca', '7356', 'Leites e derivados', 'food', 'none', null, null, 17),
  ('ibge_ipca', '7372', 'Panificados', 'food', 'none', null, null, 18),
  ('ibge_ipca', '7384', 'Óleos e gorduras', 'food', 'none', null, null, 19),
  ('ibge_ipca', '7254', 'Frutas', 'food', 'none', null, null, 20),
  ('ibge_ipca', '7241', 'Hortaliças e verduras', 'food', 'none', null, null, 21),
  ('ibge_ipca', '7433', 'Alimentação fora do domicílio', 'services', 'none', null, null, 30),
  ('ibge_ipca', '7484', 'Energia elétrica residencial', 'energy', 'none', null, null, 40),
  ('ibge_ipca', '7657', 'Gasolina', 'fuel', 'none', null, null, 50),
  ('ibge_ipca', '7659', 'Óleo diesel', 'fuel', 'none', null, null, 51),
  ('ibge_sinapi', 'm2', 'Custo médio do m² da construção', 'construction', 'price', 'R$/m²', 'BRL', 60)
) as s(source, code, name, category, value_kind, value_unit, currency_code, position)
join public.market_sources src on src.key = s.source;

-- ---------------------------------------------------------------------------
-- Agendamento diário (06:30 UTC). Só quando o pg_cron e a extensão http existem (produção Supabase).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists http with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists pg_cron;
    perform cron.schedule('anen-market-agent', '30 6 * * *', 'select private.run_market_agent()');
  end if;
end;
$$;
