-- ANEN · Fase 1 · Fundação: esquema privado, utilitários e dados de referência
-- Dados de referência (idiomas, moedas, países, regiões) são dados reais e públicos, não fictícios.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idiomas, moedas, países, regiões
-- ---------------------------------------------------------------------------

create table public.languages (
  code text primary key check (code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name text not null,
  native_name text not null,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  minor_unit smallint not null check (minor_unit between 0 and 4),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.countries (
  code char(2) primary key check (code ~ '^[A-Z]{2}$'),
  name text not null,
  default_currency_code char(3) not null references public.currencies (code),
  default_language_code text not null references public.languages (code),
  default_timezone text not null,
  is_supported boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries (code),
  parent_id uuid references public.regions (id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('mainland', 'autonomous_region', 'state', 'district', 'municipality')),
  timezone text,
  created_at timestamptz not null default now(),
  unique (country_code, code)
);
create index regions_country_idx on public.regions (country_code);
create index regions_parent_idx on public.regions (parent_id);

alter table public.languages enable row level security;
alter table public.currencies enable row level security;
alter table public.countries enable row level security;
alter table public.regions enable row level security;

-- Leitura pública; escrita apenas pelo service_role (painel admin / migrations).
create policy "languages are public" on public.languages for select to anon, authenticated using (true);
create policy "currencies are public" on public.currencies for select to anon, authenticated using (true);
create policy "countries are public" on public.countries for select to anon, authenticated using (true);
create policy "regions are public" on public.regions for select to anon, authenticated using (true);

insert into public.languages (code, name, native_name, is_enabled) values
  ('pt-PT', 'Portuguese (Portugal)', 'Português (Portugal)', true),
  ('pt-BR', 'Portuguese (Brazil)', 'Português (Brasil)', true),
  ('en', 'English', 'English', false),
  ('es', 'Spanish', 'Español', false);

insert into public.currencies (code, name, symbol, minor_unit, is_enabled) values
  ('EUR', 'Euro', '€', 2, true),
  ('BRL', 'Real brasileiro', 'R$', 2, true),
  ('USD', 'US Dollar', 'US$', 2, false);

insert into public.countries (code, name, default_currency_code, default_language_code, default_timezone, is_supported) values
  ('PT', 'Portugal', 'EUR', 'pt-PT', 'Europe/Lisbon', true),
  ('BR', 'Brasil', 'BRL', 'pt-BR', 'America/Sao_Paulo', true);

-- Portugal: as três jurisdições fiscais relevantes para o IVA (continente, Açores, Madeira).
-- Códigos ISO 3166-2 para as regiões autónomas; 'PT-CONT' é um código interno para o continente.
insert into public.regions (country_code, code, name, kind, timezone) values
  ('PT', 'PT-CONT', 'Portugal Continental', 'mainland', 'Europe/Lisbon'),
  ('PT', 'PT-20', 'Região Autónoma dos Açores', 'autonomous_region', 'Atlantic/Azores'),
  ('PT', 'PT-30', 'Região Autónoma da Madeira', 'autonomous_region', 'Atlantic/Madeira');

-- Brasil: 26 estados + Distrito Federal (ISO 3166-2:BR), com fuso horário principal de cada UF.
insert into public.regions (country_code, code, name, kind, timezone) values
  ('BR', 'BR-AC', 'Acre', 'state', 'America/Rio_Branco'),
  ('BR', 'BR-AL', 'Alagoas', 'state', 'America/Maceio'),
  ('BR', 'BR-AP', 'Amapá', 'state', 'America/Belem'),
  ('BR', 'BR-AM', 'Amazonas', 'state', 'America/Manaus'),
  ('BR', 'BR-BA', 'Bahia', 'state', 'America/Bahia'),
  ('BR', 'BR-CE', 'Ceará', 'state', 'America/Fortaleza'),
  ('BR', 'BR-DF', 'Distrito Federal', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-ES', 'Espírito Santo', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-GO', 'Goiás', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-MA', 'Maranhão', 'state', 'America/Fortaleza'),
  ('BR', 'BR-MT', 'Mato Grosso', 'state', 'America/Cuiaba'),
  ('BR', 'BR-MS', 'Mato Grosso do Sul', 'state', 'America/Campo_Grande'),
  ('BR', 'BR-MG', 'Minas Gerais', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-PA', 'Pará', 'state', 'America/Belem'),
  ('BR', 'BR-PB', 'Paraíba', 'state', 'America/Fortaleza'),
  ('BR', 'BR-PR', 'Paraná', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-PE', 'Pernambuco', 'state', 'America/Recife'),
  ('BR', 'BR-PI', 'Piauí', 'state', 'America/Fortaleza'),
  ('BR', 'BR-RJ', 'Rio de Janeiro', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-RN', 'Rio Grande do Norte', 'state', 'America/Fortaleza'),
  ('BR', 'BR-RS', 'Rio Grande do Sul', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-RO', 'Rondônia', 'state', 'America/Porto_Velho'),
  ('BR', 'BR-RR', 'Roraima', 'state', 'America/Boa_Vista'),
  ('BR', 'BR-SC', 'Santa Catarina', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-SP', 'São Paulo', 'state', 'America/Sao_Paulo'),
  ('BR', 'BR-SE', 'Sergipe', 'state', 'America/Maceio'),
  ('BR', 'BR-TO', 'Tocantins', 'state', 'America/Araguaina');

-- Valida nomes de fuso horário IANA (não é possível numa CHECK constraint).
create or replace function private.assert_valid_timezone(tz text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    raise exception 'timezone_invalid' using errcode = '22023';
  end if;
end;
$$;
