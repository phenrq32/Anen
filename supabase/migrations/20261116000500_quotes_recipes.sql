-- ANEN · Fase 3 · Orçamentos (universal) e fichas técnicas de restauração
-- Os totais são calculados no servidor com @anen/financial-engine (determinístico, testado) e
-- guardados com o orçamento; cada gravação cria uma versão imutável.
-- Taxas de imposto são indicadas pelo utilizador (o motor fiscal validado chega na Fase 5).

insert into public.permissions (key, module, description) values
  ('quotes.read', 'quotes', 'Consultar orçamentos e fichas técnicas'),
  ('quotes.write', 'quotes', 'Criar e alterar orçamentos e fichas técnicas');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in ('quotes.read', 'quotes.write')
where r.organization_id is null and (
  r.key in ('owner', 'admin', 'manager', 'employee')
  or (r.key in ('viewer', 'accountant') and p.key = 'quotes.read')
);

create or replace function private.can_access_quotes(p_org uuid, p_owner uuid, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is not null and p_owner is null then
      private.has_org_permission(p_org, case when p_write then 'quotes.write' else 'quotes.read' end)
    when p_org is null and p_owner is not null then p_owner = (select auth.uid())
    else false
  end;
$$;
revoke all on function private.can_access_quotes(uuid, uuid, boolean) from public;
grant execute on function private.can_access_quotes(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Modelos por atividade (sistema; editáveis pelo administrador da plataforma)
-- ---------------------------------------------------------------------------
create table public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]{2,40}$'),
  activity text not null,
  name text not null,
  description text,
  default_margin_percent numeric(6, 3) not null default 20 check (default_margin_percent >= 0 and default_margin_percent < 100),
  -- Linhas sugeridas SEM preços: o profissional indica os seus custos.
  lines jsonb not null default '[]'::jsonb,
  conditions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.quote_templates enable row level security;
create policy "templates readable" on public.quote_templates for select to authenticated using (is_active);
revoke insert, update, delete, truncate on public.quote_templates from anon, authenticated;
revoke all on public.quote_templates from anon;

-- ---------------------------------------------------------------------------
-- Orçamentos
-- ---------------------------------------------------------------------------
create table public.quote_counters (
  scope_id uuid not null,
  year integer not null,
  last_number integer not null default 0,
  primary key (scope_id, year)
);
alter table public.quote_counters enable row level security;
revoke all on public.quote_counters from anon, authenticated;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  number text not null,
  template_key text,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (char_length(description) <= 4000),
  client_name text check (char_length(client_name) <= 160),
  client_email text check (char_length(client_email) <= 254),
  client_tax_id text check (char_length(client_tax_id) <= 32),
  client_address text check (char_length(client_address) <= 400),
  currency_code char(3) not null references public.currencies (code),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  valid_until date,
  margin_percent numeric(6, 3) not null default 20 check (margin_percent >= 0 and margin_percent < 100),
  tax_rate_percent numeric(6, 3) not null default 0 check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
  tax_label text check (char_length(tax_label) <= 60),
  conditions text check (char_length(conditions) <= 4000),
  total_cost_minor bigint not null default 0 check (total_cost_minor >= 0 and total_cost_minor <= 9007199254740991),
  price_before_tax_minor bigint not null default 0 check (price_before_tax_minor >= 0 and price_before_tax_minor <= 9007199254740991),
  tax_minor bigint not null default 0 check (tax_minor >= 0 and tax_minor <= 9007199254740991),
  total_minor bigint not null default 0 check (total_minor >= 0 and total_minor <= 9007199254740991),
  version integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index quotes_org_number_idx on public.quotes (organization_id, number) where organization_id is not null;
create unique index quotes_owner_number_idx on public.quotes (owner_user_id, number) where owner_user_id is not null;
create index quotes_org_created_idx on public.quotes (organization_id, created_at desc);
create index quotes_owner_created_idx on public.quotes (owner_user_id, created_at desc);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  position smallint not null check (position between 0 and 499),
  kind text not null check (kind in ('material', 'labor', 'travel', 'equipment', 'overhead', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(16, 3) not null check (quantity >= 0 and quantity <= 1000000000),
  unit text check (char_length(unit) <= 20),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0 and unit_cost_minor <= 9007199254740991),
  total_cost_minor bigint not null check (total_cost_minor >= 0 and total_cost_minor <= 9007199254740991)
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);

create table public.quote_status_history (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index quote_status_history_quote_idx on public.quote_status_history (quote_id, changed_at);

-- Numeração sequencial por âmbito e ano, sem buracos por concorrência (linha bloqueada).
create or replace function private.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope uuid := coalesce(new.organization_id, new.owner_user_id);
  v_year integer := extract(year from now())::integer;
  v_next integer;
begin
  insert into public.quote_counters as c (scope_id, year, last_number) values (v_scope, v_year, 1)
  on conflict (scope_id, year) do update set last_number = c.last_number + 1
  returning last_number into v_next;
  new.number := 'ORC-' || v_year || '-' || lpad(v_next::text, 4, '0');
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.status := 'draft';
  new.version := 0;
  if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.guard_quote_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id
     or new.number <> old.number or new.created_by is distinct from old.created_by then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Orçamento aceite, recusado, expirado ou cancelado: conteúdo bloqueado; só o estado pode mudar.
  if old.status not in ('draft', 'sent') and (
       new.title, new.description, new.client_name, new.client_email, new.client_tax_id, new.client_address,
       new.currency_code, new.valid_until, new.margin_percent, new.tax_rate_percent, new.tax_label, new.conditions,
       new.total_cost_minor, new.price_before_tax_minor, new.tax_minor, new.total_minor
     ) is distinct from (
       old.title, old.description, old.client_name, old.client_email, old.client_tax_id, old.client_address,
       old.currency_code, old.valid_until, old.margin_percent, old.tax_rate_percent, old.tax_label, old.conditions,
       old.total_cost_minor, old.price_before_tax_minor, old.tax_minor, old.total_minor
     ) then
    raise exception 'quote_locked' using errcode = '22023';
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('sent', 'cancelled'))
      or (old.status = 'sent' and new.status in ('accepted', 'rejected', 'expired', 'cancelled', 'draft'))
      or (old.status in ('rejected', 'expired', 'cancelled') and new.status = 'draft')
    ) then
      raise exception 'quote_status_invalid' using errcode = '22023';
    end if;
    insert into public.quote_status_history (quote_id, from_status, to_status, changed_by)
    values (old.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create or replace function private.guard_quote_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select q.status into v_status from public.quotes q where q.id = coalesce(new.quote_id, old.quote_id);
  if v_status is not null and v_status not in ('draft', 'sent') then
    raise exception 'quote_locked' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quotes_number before insert on public.quotes for each row execute function private.assign_quote_number();
create trigger quotes_guard before update on public.quotes for each row execute function private.guard_quote_update();
create trigger quotes_updated_at before update on public.quotes for each row execute function private.set_updated_at();
create trigger quote_items_guard before insert or update or delete on public.quote_items for each row execute function private.guard_quote_items();
create trigger quotes_audit after insert or update or delete on public.quotes for each row execute function private.audit_row_change();

-- Guarda uma versão imutável (orçamento + linhas) e incrementa o número de versão.
create or replace function public.snapshot_quote(p_quote_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_version integer;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not private.can_access_quotes(v_quote.organization_id, v_quote.owner_user_id, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_version := v_quote.version + 1;
  insert into public.quote_versions (quote_id, version, snapshot, created_by)
  values (
    p_quote_id,
    v_version,
    jsonb_build_object(
      'quote', to_jsonb(v_quote) - 'version',
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.quote_items i where i.quote_id = p_quote_id), '[]'::jsonb)
    ),
    auth.uid()
  );
  update public.quotes set version = v_version where id = p_quote_id;
  return v_version;
end;
$$;
revoke all on function public.snapshot_quote(uuid) from public, anon;
grant execute on function public.snapshot_quote(uuid) to authenticated;

-- Grava conteúdo + linhas numa única transação e cria a versão. SECURITY INVOKER: o RLS aplica-se.
create or replace function public.save_quote_content(p_quote_id uuid, p_fields jsonb, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.quotes set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    client_name = p_fields ->> 'client_name',
    client_email = p_fields ->> 'client_email',
    client_tax_id = p_fields ->> 'client_tax_id',
    client_address = p_fields ->> 'client_address',
    valid_until = (p_fields ->> 'valid_until')::date,
    margin_percent = (p_fields ->> 'margin_percent')::numeric,
    tax_rate_percent = (p_fields ->> 'tax_rate_percent')::numeric,
    tax_label = p_fields ->> 'tax_label',
    conditions = p_fields ->> 'conditions',
    total_cost_minor = (p_fields ->> 'total_cost_minor')::bigint,
    price_before_tax_minor = (p_fields ->> 'price_before_tax_minor')::bigint,
    tax_minor = (p_fields ->> 'tax_minor')::bigint,
    total_minor = (p_fields ->> 'total_minor')::bigint
  where id = p_quote_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.quote_items where quote_id = p_quote_id;
  insert into public.quote_items (quote_id, position, kind, description, quantity, unit, unit_cost_minor, total_cost_minor)
  select p_quote_id, x.position, x.kind, x.description, x.quantity, x.unit, x.unit_cost_minor, x.total_cost_minor
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(position smallint, kind text, description text, quantity numeric, unit text, unit_cost_minor bigint, total_cost_minor bigint);
  return public.snapshot_quote(p_quote_id);
end;
$$;
revoke all on function public.save_quote_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_quote_content(uuid, jsonb, jsonb) to authenticated;

-- Mesmo princípio para as fichas técnicas (com registo da evolução de custo).
create or replace function public.save_recipe_content(p_recipe_id uuid, p_fields jsonb, p_ingredients jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.recipes set
    name = p_fields ->> 'name',
    category = p_fields ->> 'category',
    portions = (p_fields ->> 'portions')::numeric,
    target_food_cost_percent = (p_fields ->> 'target_food_cost_percent')::numeric,
    minimum_margin_percent = (p_fields ->> 'minimum_margin_percent')::numeric,
    tax_rate_percent = (p_fields ->> 'tax_rate_percent')::numeric,
    energy_minor = (p_fields ->> 'energy_minor')::bigint,
    water_minor = (p_fields ->> 'water_minor')::bigint,
    labor_minor = (p_fields ->> 'labor_minor')::bigint,
    packaging_minor = (p_fields ->> 'packaging_minor')::bigint,
    overhead_minor = (p_fields ->> 'overhead_minor')::bigint,
    cost_per_portion_minor = (p_fields ->> 'cost_per_portion_minor')::bigint,
    recommended_price_minor = (p_fields ->> 'recommended_price_minor')::bigint
  where id = p_recipe_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  insert into public.recipe_ingredients (recipe_id, position, name, quantity, unit, package_quantity, package_price_minor, waste_percent, cost_minor)
  select p_recipe_id, x.position, x.name, x.quantity, x.unit, x.package_quantity, x.package_price_minor, x.waste_percent, x.cost_minor
  from jsonb_to_recordset(coalesce(p_ingredients, '[]'::jsonb))
    as x(position smallint, name text, quantity numeric, unit text, package_quantity numeric, package_price_minor bigint, waste_percent numeric, cost_minor bigint);
  insert into public.recipe_cost_history (recipe_id, cost_per_portion_minor, ingredient_cost_per_portion_minor)
  values (p_recipe_id, (p_fields ->> 'cost_per_portion_minor')::bigint, (p_fields ->> 'ingredient_cost_per_portion_minor')::bigint);
end;
$$;
revoke all on function public.save_recipe_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_recipe_content(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Fichas técnicas (restauração)
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text check (char_length(category) <= 60),
  currency_code char(3) not null references public.currencies (code),
  portions numeric(10, 3) not null check (portions > 0),
  target_food_cost_percent numeric(6, 3) not null default 30 check (target_food_cost_percent > 0 and target_food_cost_percent <= 100),
  minimum_margin_percent numeric(6, 3) not null default 0 check (minimum_margin_percent >= 0 and minimum_margin_percent < 100),
  tax_rate_percent numeric(6, 3) not null default 0 check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
  energy_minor bigint not null default 0 check (energy_minor >= 0),
  water_minor bigint not null default 0 check (water_minor >= 0),
  labor_minor bigint not null default 0 check (labor_minor >= 0),
  packaging_minor bigint not null default 0 check (packaging_minor >= 0),
  overhead_minor bigint not null default 0 check (overhead_minor >= 0),
  cost_per_portion_minor bigint not null default 0 check (cost_per_portion_minor >= 0),
  recommended_price_minor bigint not null default 0 check (recommended_price_minor >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index recipes_org_idx on public.recipes (organization_id);
create index recipes_owner_idx on public.recipes (owner_user_id);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position smallint not null check (position between 0 and 199),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  quantity numeric(14, 3) not null check (quantity >= 0),
  unit text not null check (char_length(unit) between 1 and 12),
  package_quantity numeric(14, 3) not null check (package_quantity > 0),
  package_price_minor bigint not null check (package_price_minor >= 0 and package_price_minor <= 9007199254740991),
  waste_percent numeric(6, 3) not null default 0 check (waste_percent >= 0 and waste_percent < 100),
  cost_minor bigint not null check (cost_minor >= 0)
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, position);

create table public.recipe_cost_history (
  id bigint generated always as identity primary key,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  cost_per_portion_minor bigint not null,
  ingredient_cost_per_portion_minor bigint not null,
  recorded_at timestamptz not null default now()
);
create index recipe_cost_history_recipe_idx on public.recipe_cost_history (recipe_id, recorded_at);

create or replace function private.set_creator_and_lock_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id
        or new.created_by is distinct from old.created_by then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger recipes_scope before insert or update on public.recipes for each row execute function private.set_creator_and_lock_scope();
create trigger recipes_updated_at before update on public.recipes for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_status_history enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_cost_history enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['quotes', 'recipes'] loop
    execute format('create policy "read" on public.%I for select to authenticated using (private.can_access_quotes(organization_id, owner_user_id, false))', t);
    execute format('create policy "insert" on public.%I for insert to authenticated with check (private.can_access_quotes(organization_id, owner_user_id, true))', t);
    execute format('create policy "update" on public.%I for update to authenticated using (private.can_access_quotes(organization_id, owner_user_id, true)) with check (private.can_access_quotes(organization_id, owner_user_id, true))', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (private.can_access_quotes(organization_id, owner_user_id, true))', t);
  end loop;
end;
$$;

-- Tabelas-filhas herdam o acesso do pai.
create policy "read" on public.quote_items for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, false)));
create policy "write" on public.quote_items for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, true)))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, true)));
create policy "read" on public.quote_versions for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, false)));
create policy "insert" on public.quote_versions for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, true)));
create policy "read" on public.quote_status_history for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.can_access_quotes(q.organization_id, q.owner_user_id, false)));
create policy "read" on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and private.can_access_quotes(r.organization_id, r.owner_user_id, false)));
create policy "write" on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and private.can_access_quotes(r.organization_id, r.owner_user_id, true)))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and private.can_access_quotes(r.organization_id, r.owner_user_id, true)));
create policy "read" on public.recipe_cost_history for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and private.can_access_quotes(r.organization_id, r.owner_user_id, false)));
create policy "insert" on public.recipe_cost_history for insert to authenticated
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and private.can_access_quotes(r.organization_id, r.owner_user_id, true)));

revoke all on public.quotes, public.quote_items, public.quote_versions, public.quote_status_history,
  public.recipes, public.recipe_ingredients, public.recipe_cost_history from anon;
revoke update, delete, truncate on public.quote_versions, public.quote_status_history, public.recipe_cost_history from authenticated;
revoke insert on public.quote_status_history from authenticated;
revoke update on public.quotes from authenticated;
grant update (title, description, client_name, client_email, client_tax_id, client_address, currency_code, status, valid_until,
  margin_percent, tax_rate_percent, tax_label, conditions, total_cost_minor, price_before_tax_minor, tax_minor, total_minor)
  on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- Modelos por atividade (linhas sugeridas, sem preços)
-- ---------------------------------------------------------------------------
insert into public.quote_templates (key, activity, name, default_margin_percent, lines) values
  ('construction', 'construction', 'Construção', 20, '[{"kind":"material","description":"Materiais de construção","unit":"un"},{"kind":"labor","description":"Mão de obra (pedreiro)","unit":"h"},{"kind":"labor","description":"Mão de obra (servente)","unit":"h"},{"kind":"equipment","description":"Aluguer de equipamento","unit":"dia"},{"kind":"travel","description":"Deslocação","unit":"km"},{"kind":"overhead","description":"Licenças, seguros e resíduos","unit":"un"}]'),
  ('renovation', 'renovation', 'Remodelação', 22, '[{"kind":"labor","description":"Demolição e preparação","unit":"h"},{"kind":"material","description":"Materiais","unit":"un"},{"kind":"labor","description":"Execução","unit":"h"},{"kind":"overhead","description":"Remoção de entulho","unit":"un"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('painting', 'painting', 'Pintura', 25, '[{"kind":"material","description":"Tinta","unit":"L"},{"kind":"material","description":"Primário / selante","unit":"L"},{"kind":"material","description":"Fita, lixas, plásticos de proteção","unit":"un"},{"kind":"labor","description":"Preparação de superfícies","unit":"h"},{"kind":"labor","description":"Pintura","unit":"h"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('electrical', 'electrical', 'Eletricidade', 25, '[{"kind":"material","description":"Tomadas / interruptores","unit":"un"},{"kind":"material","description":"Cabo elétrico","unit":"m"},{"kind":"material","description":"Caixas e tubagem","unit":"un"},{"kind":"labor","description":"Instalação","unit":"h"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('plumbing', 'plumbing', 'Canalização', 25, '[{"kind":"material","description":"Tubagem e acessórios","unit":"un"},{"kind":"material","description":"Torneiras / louças","unit":"un"},{"kind":"labor","description":"Instalação / reparação","unit":"h"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('health', 'health', 'Saúde (consultas e tratamentos)', 30, '[{"kind":"labor","description":"Consulta / sessão","unit":"sessão"},{"kind":"material","description":"Consumíveis","unit":"un"},{"kind":"overhead","description":"Espaço e equipamento","unit":"sessão"}]'),
  ('beauty', 'beauty', 'Estética', 35, '[{"kind":"labor","description":"Serviço","unit":"h"},{"kind":"material","description":"Produtos","unit":"un"},{"kind":"overhead","description":"Espaço e equipamento","unit":"h"}]'),
  ('food_service', 'food_service', 'Restauração / catering', 30, '[{"kind":"material","description":"Ingredientes","unit":"dose"},{"kind":"labor","description":"Cozinha e serviço","unit":"h"},{"kind":"equipment","description":"Equipamento e loiça","unit":"un"},{"kind":"travel","description":"Transporte","unit":"km"}]'),
  ('technology', 'technology', 'Tecnologia / desenvolvimento', 30, '[{"kind":"labor","description":"Análise e desenho","unit":"h"},{"kind":"labor","description":"Desenvolvimento","unit":"h"},{"kind":"labor","description":"Testes e implementação","unit":"h"},{"kind":"other","description":"Licenças e serviços de terceiros","unit":"mês"}]'),
  ('automotive', 'automotive', 'Automóvel / oficina', 25, '[{"kind":"material","description":"Peças","unit":"un"},{"kind":"material","description":"Óleos e consumíveis","unit":"un"},{"kind":"labor","description":"Mão de obra","unit":"h"},{"kind":"equipment","description":"Diagnóstico","unit":"un"}]'),
  ('cleaning', 'cleaning', 'Limpeza', 25, '[{"kind":"labor","description":"Limpeza","unit":"h"},{"kind":"material","description":"Produtos de limpeza","unit":"un"},{"kind":"equipment","description":"Equipamento","unit":"un"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('design', 'design', 'Design', 35, '[{"kind":"labor","description":"Briefing e pesquisa","unit":"h"},{"kind":"labor","description":"Criação","unit":"h"},{"kind":"labor","description":"Revisões","unit":"h"},{"kind":"other","description":"Licenças de imagens / fontes","unit":"un"}]'),
  ('marketing', 'marketing', 'Marketing', 30, '[{"kind":"labor","description":"Estratégia","unit":"h"},{"kind":"labor","description":"Produção de conteúdos","unit":"h"},{"kind":"other","description":"Investimento em anúncios","unit":"un"},{"kind":"labor","description":"Relatórios","unit":"h"}]'),
  ('transport', 'transport', 'Transportes e mudanças', 25, '[{"kind":"travel","description":"Quilómetros","unit":"km"},{"kind":"labor","description":"Carga e descarga","unit":"h"},{"kind":"overhead","description":"Portagens / pedágios","unit":"un"},{"kind":"material","description":"Material de embalagem","unit":"un"}]'),
  ('education', 'education', 'Educação e formação', 35, '[{"kind":"labor","description":"Aulas / formação","unit":"h"},{"kind":"labor","description":"Preparação","unit":"h"},{"kind":"material","description":"Materiais didáticos","unit":"un"}]'),
  ('agriculture', 'agriculture', 'Agricultura', 20, '[{"kind":"material","description":"Sementes / plantas","unit":"un"},{"kind":"material","description":"Fertilizantes","unit":"kg"},{"kind":"labor","description":"Mão de obra","unit":"h"},{"kind":"equipment","description":"Maquinaria","unit":"h"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('events', 'events', 'Eventos', 30, '[{"kind":"labor","description":"Organização","unit":"h"},{"kind":"equipment","description":"Aluguer de equipamento","unit":"un"},{"kind":"other","description":"Espaço","unit":"dia"},{"kind":"other","description":"Catering","unit":"pessoa"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('consulting', 'consulting', 'Consultoria', 35, '[{"kind":"labor","description":"Diagnóstico","unit":"h"},{"kind":"labor","description":"Consultoria","unit":"h"},{"kind":"labor","description":"Relatório","unit":"h"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('home_services', 'home_services', 'Serviços domésticos', 25, '[{"kind":"labor","description":"Serviço","unit":"h"},{"kind":"material","description":"Materiais","unit":"un"},{"kind":"travel","description":"Deslocação","unit":"km"}]'),
  ('blank', 'other', 'Em branco', 20, '[]');
