-- ANEN · Plano do mês (finanças pessoais)
-- Salário do mês, despesas fixas editáveis e orientação para a sobra.
-- A orientação é educativa: as opções vêm de um catálogo versionado com fonte oficial e data
-- de revisão. Não guardamos taxas de rendimento (mudam e não as inventamos): cada opção aponta
-- para a fonte onde o utilizador confirma as condições atuais.

-- ---------------------------------------------------------------------------
-- Despesas fixas (lista permanente da pessoa; o valor pode ser alterado a qualquer momento)
-- ---------------------------------------------------------------------------
create table public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  category_id uuid references public.transaction_categories (id) on delete set null,
  is_active boolean not null default true,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fixed_expenses_owner_idx on public.fixed_expenses (owner_user_id, position, created_at);

-- ---------------------------------------------------------------------------
-- Plano de cada mês: salário e reserva de emergência que a pessoa já tem
-- ---------------------------------------------------------------------------
create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  currency_code char(3) not null references public.currencies (code),
  salary_minor bigint not null check (salary_minor >= 0 and salary_minor <= 9007199254740991),
  emergency_reserve_minor bigint not null default 0 check (emergency_reserve_minor >= 0 and emergency_reserve_minor <= 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, month)
);

create or replace function private.validate_plan_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  if tg_table_name = 'fixed_expenses' then
    if (to_jsonb(new) ->> 'category_id') is not null and not exists (
      select 1 from public.transaction_categories c
      where c.id = (to_jsonb(new) ->> 'category_id')::uuid and c.kind = 'expense'
        and (c.is_system or c.owner_user_id = new.owner_user_id)
    ) then
      raise exception 'category_invalid' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger fixed_expenses_validate before insert or update on public.fixed_expenses for each row execute function private.validate_plan_row();
create trigger monthly_plans_validate before insert or update on public.monthly_plans for each row execute function private.validate_plan_row();
create trigger fixed_expenses_updated_at before update on public.fixed_expenses for each row execute function private.set_updated_at();
create trigger monthly_plans_updated_at before update on public.monthly_plans for each row execute function private.set_updated_at();

alter table public.fixed_expenses enable row level security;
alter table public.monthly_plans enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['fixed_expenses', 'monthly_plans'] loop
    execute format('create policy "own read" on public.%I for select to authenticated using (owner_user_id = (select auth.uid()))', t);
    execute format('create policy "own insert" on public.%I for insert to authenticated with check (owner_user_id = (select auth.uid()))', t);
    execute format('create policy "own update" on public.%I for update to authenticated using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()))', t);
    execute format('create policy "own delete" on public.%I for delete to authenticated using (owner_user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catálogo de opções (referência pública, escrita só pelo service_role)
-- bucket: reserve (reserva de emergência), long_term (objetivos de longo prazo)
-- Nomes e descrições são traduzidos na interface pela chave.
-- ---------------------------------------------------------------------------
create table public.investment_options (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries (code),
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  bucket text not null check (bucket in ('reserve', 'long_term')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  liquidity text not null check (liquidity in ('immediate', 'days', 'months', 'years')),
  position smallint not null default 0,
  source_name text not null,
  source_url text not null check (source_url ~ '^https://'),
  reviewed_on date not null,
  is_active boolean not null default true,
  unique (country_code, key)
);
alter table public.investment_options enable row level security;
create policy "options readable" on public.investment_options for select to anon, authenticated using (is_active);
revoke insert, update, delete, truncate on public.investment_options from anon, authenticated;

insert into public.investment_options (country_code, key, bucket, risk, liquidity, position, source_name, source_url, reviewed_on) values
  ('PT', 'pt_savings_deposit', 'reserve', 'low', 'immediate', 1, 'Banco de Portugal · Portal do Cliente Bancário', 'https://clientebancario.bportugal.pt/', '2026-11-16'),
  ('PT', 'pt_savings_certificates', 'reserve', 'low', 'months', 2, 'IGCP · Agência de Gestão da Tesouraria e da Dívida Pública', 'https://www.igcp.pt/', '2026-11-16'),
  ('PT', 'pt_term_deposit', 'reserve', 'low', 'months', 3, 'Fundo de Garantia de Depósitos', 'https://www.fgd.pt/', '2026-11-16'),
  ('PT', 'pt_index_funds', 'long_term', 'high', 'days', 1, 'CMVM · Comissão do Mercado de Valores Mobiliários', 'https://www.cmvm.pt/', '2026-11-16'),
  ('PT', 'pt_ppr', 'long_term', 'medium', 'years', 2, 'ASF · Autoridade de Supervisão de Seguros e Fundos de Pensões', 'https://www.asf.com.pt/', '2026-11-16'),
  ('BR', 'br_tesouro_selic', 'reserve', 'low', 'days', 1, 'Tesouro Direto · Tesouro Nacional', 'https://www.tesourodireto.com.br/', '2026-11-16'),
  ('BR', 'br_cdb_daily', 'reserve', 'low', 'immediate', 2, 'FGC · Fundo Garantidor de Créditos', 'https://www.fgc.org.br/', '2026-11-16'),
  ('BR', 'br_lci_lca', 'reserve', 'low', 'months', 3, 'FGC · Fundo Garantidor de Créditos', 'https://www.fgc.org.br/', '2026-11-16'),
  ('BR', 'br_tesouro_ipca', 'long_term', 'medium', 'years', 1, 'Tesouro Direto · Tesouro Nacional', 'https://www.tesourodireto.com.br/', '2026-11-16'),
  ('BR', 'br_index_funds', 'long_term', 'high', 'days', 2, 'CVM · Comissão de Valores Mobiliários', 'https://www.gov.br/cvm/', '2026-11-16'),
  ('BR', 'br_private_pension', 'long_term', 'medium', 'years', 3, 'SUSEP · Superintendência de Seguros Privados', 'https://www.gov.br/susep/', '2026-11-16');
