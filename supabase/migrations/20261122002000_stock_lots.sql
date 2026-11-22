-- Lotes e validades no stock, consumo pelas fichas técnicas e avisos de validade.
--
-- Cada entrada cria um lote (código e validade opcionais). Saídas, perdas e contagens para baixo consomem os
-- lotes pelo que vence primeiro (FEFO: validade mais próxima, depois os sem validade, depois os mais antigos),
-- ou um lote escolhido. Cada parte consumida fica em stock_lot_movements (rastreio). Invariante:
-- a soma de quantity_remaining dos lotes = stock_items.quantity_on_hand.
--
-- O saldo e o custo médio continuam a ser calculados por private.apply_stock_movement (BEFORE INSERT, mig. 1500,
-- redefinida aqui a partir dessa versão); os lotes são tratados num AFTER INSERT (o movimento já existe e pode ser
-- referenciado). Os movimentos continuam imutáveis.
--
-- Fichas técnicas: um ingrediente pode ligar-se a um artigo de stock; public.produce_recipe regista uma produção
-- (N porções) e dá saída dos ingredientes ligados, com a perda da preparação e a conversão de unidades
-- (private.unit_factor espelha packages/financial-engine/src/units.ts; há um teste que compara os dois).

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  item_id uuid not null references public.stock_items (id) on delete cascade,
  code text check (char_length(code) <= 60),
  expires_on date,
  received_on date not null,
  quantity_received numeric(14, 3) not null check (quantity_received >= 0),
  quantity_remaining numeric(14, 3) not null check (quantity_remaining >= 0),
  unit_cost_minor bigint not null check (unit_cost_minor between 0 and 9007199254740991),
  -- 'in' (entrada), 'count' (contagem acima do saldo) ou 'opening' (saldo que já existia antes dos lotes).
  origin text not null check (origin in ('in', 'count', 'opening')),
  source_movement_id uuid references public.stock_movements (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_lots_scope check ((organization_id is null) <> (owner_user_id is null)),
  constraint stock_lots_remaining check (quantity_remaining <= quantity_received)
);
create index stock_lots_fefo_idx on public.stock_lots (item_id, expires_on nulls last, received_on, created_at) where quantity_remaining > 0;
create index stock_lots_expiry_idx on public.stock_lots (expires_on) where quantity_remaining > 0 and expires_on is not null;

create table public.recipe_productions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  recipe_id uuid references public.recipes (id) on delete set null,
  recipe_name text not null check (char_length(recipe_name) between 1 and 120),
  portions numeric(10, 3) not null check (portions > 0),
  occurred_on date not null,
  notes text check (char_length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recipe_productions_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index recipe_productions_recipe_idx on public.recipe_productions (recipe_id, created_at desc);

alter table public.stock_movements
  add column lot_code text check (char_length(lot_code) <= 60),
  add column expires_on date,
  add column lot_id uuid references public.stock_lots (id) on delete set null,
  add column production_id uuid references public.recipe_productions (id) on delete set null;
create index stock_movements_production_idx on public.stock_movements (production_id) where production_id is not null;

create table public.stock_lot_movements (
  movement_id uuid not null references public.stock_movements (id) on delete cascade,
  lot_id uuid not null references public.stock_lots (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  -- Negativo: consumido do lote; positivo: o lote nasceu deste movimento.
  quantity numeric(15, 3) not null check (quantity <> 0),
  primary key (movement_id, lot_id),
  constraint stock_lot_movements_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index stock_lot_movements_lot_idx on public.stock_lot_movements (lot_id);

alter table public.recipe_ingredients
  add column stock_item_id uuid references public.stock_items (id) on delete set null;
create index recipe_ingredients_stock_item_idx on public.recipe_ingredients (stock_item_id) where stock_item_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Unidades (espelho de packages/financial-engine/src/units.ts)
-- ---------------------------------------------------------------------------
create or replace function private.unit_factor(p_unit text, out dimension text, out factor numeric)
language sql
immutable
set search_path = ''
as $$
  select u.dimension, u.factor
  from (values
    ('mg', 'mass', 0.001), ('g', 'mass', 1), ('gr', 'mass', 1), ('grama', 'mass', 1), ('gramas', 'mass', 1),
    ('kg', 'mass', 1000), ('quilo', 'mass', 1000), ('quilos', 'mass', 1000),
    ('ml', 'volume', 1), ('cl', 'volume', 10), ('dl', 'volume', 100), ('l', 'volume', 1000), ('lt', 'volume', 1000),
    ('litro', 'volume', 1000), ('litros', 'volume', 1000),
    ('un', 'count', 1), ('und', 'count', 1), ('unid', 'count', 1), ('unidade', 'count', 1), ('unidades', 'count', 1),
    ('dz', 'count', 12), ('duzia', 'count', 12), ('dúzia', 'count', 12)
  ) as u(unit, dimension, factor)
  where u.unit = regexp_replace(lower(btrim(coalesce(p_unit, ''))), '\.$', '');
$$;
revoke all on function private.unit_factor(text) from public, anon, authenticated;

-- Quantas unidades `p_to` há numa unidade `p_from`; mesma unidade (texto igual) = 1; null se não converte.
create or replace function private.unit_ratio(p_from text, p_to text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(lower(btrim(coalesce(p_from, ''))), '\.$', '') = regexp_replace(lower(btrim(coalesce(p_to, ''))), '\.$', '') then 1::numeric
    else (select a.factor / b.factor from private.unit_factor(p_from) a, private.unit_factor(p_to) b where a.dimension = b.dimension)
  end;
$$;
revoke all on function private.unit_ratio(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Movimentos: validação dos campos de lote (BEFORE) e lotes (AFTER)
-- ---------------------------------------------------------------------------
-- Parte da versão da migration 1500 e acrescenta: campos de lote só nas entradas; lote escolhido só em saídas
-- e perdas, do mesmo artigo e com quantidade suficiente.
create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.stock_items%rowtype;
  v_balance numeric(14, 3);
  v_average bigint;
  v_lot public.stock_lots%rowtype;
begin
  select * into v_item from public.stock_items where id = new.item_id for update;
  if not found
     or v_item.organization_id is distinct from new.organization_id
     or v_item.owner_user_id is distinct from new.owner_user_id
     or v_item.archived_at is not null then
    raise exception 'stock_item_invalid' using errcode = '22023';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  v_balance := v_item.quantity_on_hand;
  v_average := v_item.average_cost_minor;

  new.lot_code := nullif(btrim(coalesce(new.lot_code, '')), '');
  if new.kind <> 'in' and (new.lot_code is not null or new.expires_on is not null) then
    raise exception 'stock_lot_invalid' using errcode = '22023';
  end if;
  if new.lot_id is not null then
    if new.kind not in ('out', 'loss') then
      raise exception 'stock_lot_invalid' using errcode = '22023';
    end if;
    select * into v_lot from public.stock_lots where id = new.lot_id for update;
    if not found or v_lot.item_id <> new.item_id then
      raise exception 'stock_lot_invalid' using errcode = '22023';
    end if;
    if new.quantity > v_lot.quantity_remaining then
      raise exception 'stock_insufficient' using errcode = '22023';
    end if;
  end if;
  -- A ligação à produção só pode ser feita pela função de produção.
  if new.production_id is not null and coalesce(current_setting('anen.producing', true), '') <> new.production_id::text then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new.kind = 'in' then
    if new.quantity <= 0 then
      raise exception 'quantity_invalid' using errcode = '22023';
    end if;
    if new.unit_cost_minor is null then
      raise exception 'amount_invalid' using errcode = '22023';
    end if;
    -- Divisão inteira exata, a meio para cima: div(2n + d, 2d) (o motor faz o mesmo).
    v_average := div(2 * (v_balance * v_average + new.quantity * new.unit_cost_minor) + (v_balance + new.quantity),
                     2 * (v_balance + new.quantity))::bigint;
    new.quantity_change := new.quantity;
    v_balance := v_balance + new.quantity;
  elsif new.kind in ('out', 'loss') then
    if new.quantity <= 0 then
      raise exception 'quantity_invalid' using errcode = '22023';
    end if;
    if new.quantity > v_balance then
      raise exception 'stock_insufficient' using errcode = '22023';
    end if;
    new.unit_cost_minor := v_average;
    new.quantity_change := -new.quantity;
    v_balance := v_balance - new.quantity;
  else -- count
    new.unit_cost_minor := v_average;
    new.quantity_change := new.quantity - v_balance;
    v_balance := new.quantity;
  end if;

  new.balance_after := v_balance;
  new.average_cost_after := v_average;
  update public.stock_items set quantity_on_hand = v_balance, average_cost_minor = v_average where id = v_item.id;
  return new;
end;
$$;

-- Lotes do movimento (o artigo continua bloqueado pelo BEFORE desta mesma instrução).
create or replace function private.apply_stock_lots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot uuid;
  v_need numeric(15, 3);
  v_take numeric(15, 3);
  r record;
begin
  if new.quantity_change > 0 then
    insert into public.stock_lots (organization_id, owner_user_id, item_id, code, expires_on, received_on, quantity_received,
                                   quantity_remaining, unit_cost_minor, origin, source_movement_id)
    values (new.organization_id, new.owner_user_id, new.item_id, new.lot_code, new.expires_on, new.occurred_on, new.quantity_change,
            new.quantity_change, new.unit_cost_minor, case when new.kind = 'in' then 'in' else 'count' end, new.id)
    returning id into v_lot;
    insert into public.stock_lot_movements (movement_id, lot_id, organization_id, owner_user_id, quantity)
    values (new.id, v_lot, new.organization_id, new.owner_user_id, new.quantity_change);
  elsif new.quantity_change < 0 then
    v_need := -new.quantity_change;
    for r in
      select l.id, l.quantity_remaining from public.stock_lots l
      where l.item_id = new.item_id and l.quantity_remaining > 0 and (new.lot_id is null or l.id = new.lot_id)
      order by l.expires_on nulls last, l.received_on, l.created_at, l.id
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, r.quantity_remaining);
      update public.stock_lots set quantity_remaining = quantity_remaining - v_take where id = r.id;
      insert into public.stock_lot_movements (movement_id, lot_id, organization_id, owner_user_id, quantity)
      values (new.id, r.id, new.organization_id, new.owner_user_id, -v_take);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      -- Não acontece com a invariante mantida; se acontecer, o movimento é recusado (nada fica a meio).
      raise exception 'stock_insufficient' using errcode = '22023';
    end if;
  end if;
  return null;
end;
$$;
create trigger stock_movements_lots after insert on public.stock_movements
  for each row execute function private.apply_stock_lots();

-- Saldos que já existiam: um lote de abertura sem validade, ao custo médio atual.
insert into public.stock_lots (organization_id, owner_user_id, item_id, received_on, quantity_received, quantity_remaining, unit_cost_minor, origin)
select i.organization_id, i.owner_user_id, i.id,
       coalesce((select max(mv.occurred_on) from public.stock_movements mv where mv.item_id = i.id), current_date),
       i.quantity_on_hand, i.quantity_on_hand, i.average_cost_minor, 'opening'
from public.stock_items i
where i.quantity_on_hand > 0;

-- ---------------------------------------------------------------------------
-- 4. Fichas técnicas ligadas ao stock
-- ---------------------------------------------------------------------------
-- O artigo tem de ser do mesmo âmbito da ficha e a unidade tem de converter (g ↔ kg, ml ↔ l, un ↔ dz…).
create or replace function private.validate_recipe_ingredient_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit text;
begin
  if new.stock_item_id is null or (tg_op = 'UPDATE' and new.stock_item_id is not distinct from old.stock_item_id and new.unit = old.unit) then
    return new;
  end if;
  select s.unit into v_unit
  from public.recipes r
  join public.stock_items s on s.id = new.stock_item_id
  where r.id = new.recipe_id
    and s.organization_id is not distinct from r.organization_id
    and s.owner_user_id is not distinct from r.owner_user_id;
  if not found then
    raise exception 'stock_item_invalid' using errcode = '22023';
  end if;
  if private.unit_ratio(new.unit, v_unit) is null then
    raise exception 'stock_unit_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger recipe_ingredients_stock before insert or update on public.recipe_ingredients
  for each row execute function private.validate_recipe_ingredient_stock();

-- Gravação: parte da versão da migration 1300 e acrescenta stock_item_id. Uma ligação NOVA ao stock exige poder
-- ler o stock (business.read), como os preços de fornecedores.
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
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_ingredients, '[]'::jsonb)) as x(supplier_price_id text)
    where nullif(x.supplier_price_id, '') is not null
      and nullif(x.supplier_price_id, '')::uuid not in (
        select ri.supplier_price_id from public.recipe_ingredients ri where ri.recipe_id = p_recipe_id and ri.supplier_price_id is not null
      )
  ) and not exists (
    select 1 from public.recipes r where r.id = p_recipe_id and private.can_access_business(r.organization_id, r.owner_user_id, false)
  ) then
    raise exception 'supplier_price_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_ingredients, '[]'::jsonb)) as x(stock_item_id text)
    where nullif(x.stock_item_id, '') is not null
      and nullif(x.stock_item_id, '')::uuid not in (
        select ri.stock_item_id from public.recipe_ingredients ri where ri.recipe_id = p_recipe_id and ri.stock_item_id is not null
      )
  ) and not exists (
    select 1 from public.recipes r where r.id = p_recipe_id and private.can_access_business(r.organization_id, r.owner_user_id, false)
  ) then
    raise exception 'stock_item_invalid' using errcode = '22023';
  end if;
  delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  insert into public.recipe_ingredients (recipe_id, position, name, quantity, unit, package_quantity, package_price_minor, waste_percent, cost_minor,
                                         supplier_price_id, stock_item_id)
  select p_recipe_id, x.position, x.name, x.quantity, x.unit, x.package_quantity, x.package_price_minor, x.waste_percent, x.cost_minor,
         nullif(x.supplier_price_id, '')::uuid, nullif(x.stock_item_id, '')::uuid
  from jsonb_to_recordset(coalesce(p_ingredients, '[]'::jsonb))
    as x(position smallint, name text, quantity numeric, unit text, package_quantity numeric, package_price_minor bigint, waste_percent numeric,
         cost_minor bigint, supplier_price_id text, stock_item_id text);
  insert into public.recipe_cost_history (recipe_id, cost_per_portion_minor, ingredient_cost_per_portion_minor)
  values (p_recipe_id, (p_fields ->> 'cost_per_portion_minor')::bigint, (p_fields ->> 'ingredient_cost_per_portion_minor')::bigint);
end;
$$;
revoke all on function public.save_recipe_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_recipe_content(uuid, jsonb, jsonb) to authenticated;

-- Quantidade de stock que uma produção gasta de um ingrediente: quantidade × porções / porções da ficha,
-- com a perda da preparação (÷ (1 − perda)), convertida para a unidade do artigo; 3 casas, a meio para cima,
-- e pelo menos 0,001 quando há consumo.
create or replace function private.ingredient_stock_quantity(
  p_quantity numeric, p_unit text, p_waste numeric, p_recipe_portions numeric, p_portions numeric, p_stock_unit text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_quantity <= 0 then 0::numeric
    else greatest(0.001, round(p_quantity * p_portions / p_recipe_portions * 100 / (100 - p_waste) * private.unit_ratio(p_unit, p_stock_unit), 3))
  end;
$$;
revoke all on function private.ingredient_stock_quantity(numeric, text, numeric, numeric, numeric, text) from public, anon, authenticated;

-- Regista uma produção e dá saída dos ingredientes ligados (tudo ou nada). Exige ler a ficha e escrever no stock.
create or replace function public.produce_recipe(p_recipe_id uuid, p_portions numeric, p_occurred_on date default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe public.recipes%rowtype;
  v_production uuid;
  v_line record;
  v_qty numeric;
  v_count integer := 0;
begin
  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found
     or not private.can_access_quotes(v_recipe.organization_id, v_recipe.owner_user_id, false)
     or not private.can_access_business(v_recipe.organization_id, v_recipe.owner_user_id, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_portions is null or p_portions <= 0 or p_portions > 1000000 then
    raise exception 'quantity_invalid' using errcode = '22023';
  end if;
  insert into public.recipe_productions (organization_id, owner_user_id, recipe_id, recipe_name, portions, occurred_on, notes, created_by)
  values (v_recipe.organization_id, v_recipe.owner_user_id, v_recipe.id, v_recipe.name, round(p_portions, 3),
          coalesce(p_occurred_on, current_date), left(nullif(btrim(coalesce(p_notes, '')), ''), 500), auth.uid())
  returning id into v_production;

  perform set_config('anen.producing', v_production::text, true);
  for v_line in
    select ri.*, s.unit as stock_unit
    from public.recipe_ingredients ri
    join public.stock_items s on s.id = ri.stock_item_id
    where ri.recipe_id = p_recipe_id
    order by ri.position, ri.id
  loop
    v_qty := private.ingredient_stock_quantity(v_line.quantity, v_line.unit, v_line.waste_percent, v_recipe.portions, p_portions, v_line.stock_unit);
    if v_qty is null then
      raise exception 'stock_unit_mismatch' using errcode = '22023';
    end if;
    continue when v_qty = 0;
    insert into public.stock_movements (organization_id, owner_user_id, item_id, kind, quantity, occurred_on, notes, production_id)
    values (v_recipe.organization_id, v_recipe.owner_user_id, v_line.stock_item_id, 'out', v_qty, coalesce(p_occurred_on, current_date),
            left(v_recipe.name || ' × ' || trim_scale(round(p_portions, 3))::text, 500), v_production);
    v_count := v_count + 1;
  end loop;
  perform set_config('anen.producing', '', true);
  if v_count = 0 then
    raise exception 'recipe_no_stock_links' using errcode = '22023';
  end if;
  return v_production;
end;
$$;
revoke all on function public.produce_recipe(uuid, numeric, date, text) from public, anon;
grant execute on function public.produce_recipe(uuid, numeric, date, text) to authenticated;

create trigger recipe_productions_audit after insert on public.recipe_productions for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 5. RLS: só leitura para as pessoas (as escritas vêm dos triggers e da função de produção)
-- ---------------------------------------------------------------------------
alter table public.stock_lots enable row level security;
alter table public.stock_lot_movements enable row level security;
alter table public.recipe_productions enable row level security;
create policy "business read" on public.stock_lots for select to authenticated
  using (private.can_access_business(organization_id, owner_user_id, false));
create policy "business read" on public.stock_lot_movements for select to authenticated
  using (private.can_access_business(organization_id, owner_user_id, false));
create policy "business read" on public.recipe_productions for select to authenticated
  using (private.can_access_business(organization_id, owner_user_id, false));
revoke all on public.stock_lots, public.stock_lot_movements, public.recipe_productions from anon, authenticated;
grant select on public.stock_lots, public.stock_lot_movements, public.recipe_productions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Avisos de validade
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('payment_overdue', 'payment_due_soon', 'stock_below_minimum', 'purchase_late', 'market_alert', 'stock_expiring', 'stock_expired'));
alter table public.notification_settings drop constraint notification_settings_disabled_kinds_check;
alter table public.notification_settings add constraint notification_settings_disabled_kinds_check
  check (disabled_kinds <@ array['payment_overdue', 'payment_due_soon', 'stock_below_minimum', 'purchase_late', 'market_alert', 'stock_expiring', 'stock_expired']);
alter table public.notification_settings
  add column expiry_soon_days smallint not null default 7 check (expiry_soon_days between 1 and 60);
grant update (expiry_soon_days) on public.notification_settings to authenticated;

-- Parte da versão da migration 1600 e acrescenta os lotes a vencer e vencidos (com quantidade).
create or replace function private.generate_notifications(p_today date default current_date, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_rows integer;
begin
  -- Quem recebe o quê: a própria pessoa para os dados pessoais; os membros ativos com a permissão para os da organização.
  create temporary table if not exists notif_audience (user_id uuid, organization_id uuid, owner_user_id uuid, permission text) on commit drop;
  truncate notif_audience;
  insert into notif_audience
  select u.id, null, u.id, p.permission
  from auth.users u cross join (values ('finance.read'), ('business.read')) as p(permission)
  where p_user is null or u.id = p_user;
  insert into notif_audience
  select m.user_id, m.organization_id, null, rp.permission_key
  from public.organization_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.status = 'active' and rp.permission_key in ('finance.read', 'business.read')
    and (p_user is null or m.user_id = p_user);

  -- Pagamentos vencidos (uma vez por movimento e vencimento).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'payment_overdue', t.id,
         jsonb_build_object('description', t.description, 'direction', t.kind, 'remaining_minor', t.amount_minor - t.settled_minor,
                            'currency', t.currency_code, 'due_on', t.due_on),
         '/financas/em-aberto', 'overdue:' || t.id || ':' || t.due_on
  from notif_audience a
  join public.transactions t
    on t.organization_id is not distinct from a.organization_id and t.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'finance.read'
    and t.settled_minor < t.amount_minor and t.due_on is not null and t.due_on < p_today
    and not ('payment_overdue' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- A vencer nos próximos N dias.
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'payment_due_soon', t.id,
         jsonb_build_object('description', t.description, 'direction', t.kind, 'remaining_minor', t.amount_minor - t.settled_minor,
                            'currency', t.currency_code, 'due_on', t.due_on),
         '/financas/em-aberto', 'due:' || t.id || ':' || t.due_on
  from notif_audience a
  join public.transactions t
    on t.organization_id is not distinct from a.organization_id and t.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'finance.read'
    and t.settled_minor < t.amount_minor and t.due_on is not null
    and t.due_on between p_today and p_today + coalesce(s.due_soon_days, 3)
    and not ('payment_due_soon' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Stock abaixo do mínimo: uma vez por episódio (desde a última vez que esteve no mínimo ou acima).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'stock_below_minimum', i.id,
         jsonb_build_object('name', i.name, 'quantity', i.quantity_on_hand, 'minimum', i.min_quantity, 'unit', i.unit),
         '/inventario/' || i.id,
         'stock:' || i.id || ':' || coalesce((
           select mv.id::text from public.stock_movements mv
           where mv.item_id = i.id and mv.balance_after >= i.min_quantity
           order by mv.created_at desc limit 1
         ), 'start')
  from notif_audience a
  join public.stock_items i
    on i.organization_id is not distinct from a.organization_id and i.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and i.archived_at is null and i.min_quantity > 0 and i.quantity_on_hand < i.min_quantity
    and not ('stock_below_minimum' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Encomendas atrasadas.
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'purchase_late', o.id,
         jsonb_build_object('supplier', c.name, 'expected_on', o.expected_on, 'total_minor', o.total_minor, 'currency', o.currency_code),
         '/compras/' || o.id, 'late:' || o.id || ':' || o.expected_on
  from notif_audience a
  join public.purchase_orders o
    on o.organization_id is not distinct from a.organization_id and o.owner_user_id is not distinct from a.owner_user_id
  left join public.contacts c on c.id = o.supplier_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and o.status = 'ordered' and o.expected_on is not null and o.expected_on < p_today
    and not ('purchase_late' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Alertas do agente de mercado (dos últimos 60 dias, para não inundar quem chega agora).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'market_alert', al.id,
         jsonb_build_object('series', se.name, 'period', al.period, 'change_month', al.change_month, 'threshold', al.threshold_percent),
         '/mercado', 'market:' || al.id
  from notif_audience a
  join public.market_alerts al
    on al.organization_id is not distinct from a.organization_id and al.owner_user_id is not distinct from a.owner_user_id
  join public.market_series se on se.id = al.series_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and al.created_at >= p_today - 60
    and not ('market_alert' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Lotes com quantidade que vencem nos próximos N dias (uma vez por lote e validade).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'stock_expiring', l.id,
         jsonb_build_object('name', i.name, 'code', l.code, 'expires_on', l.expires_on, 'quantity', l.quantity_remaining, 'unit', i.unit),
         '/inventario/' || i.id, 'expiring:' || l.id || ':' || l.expires_on
  from notif_audience a
  join public.stock_lots l
    on l.organization_id is not distinct from a.organization_id and l.owner_user_id is not distinct from a.owner_user_id
  join public.stock_items i on i.id = l.item_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and i.archived_at is null and l.quantity_remaining > 0 and l.expires_on is not null
    and l.expires_on between p_today and p_today + coalesce(s.expiry_soon_days, 7)
    and not ('stock_expiring' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Lotes vencidos que ainda têm quantidade (registar a perda ou corrigir a validade).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'stock_expired', l.id,
         jsonb_build_object('name', i.name, 'code', l.code, 'expires_on', l.expires_on, 'quantity', l.quantity_remaining, 'unit', i.unit),
         '/inventario/' || i.id, 'expired:' || l.id || ':' || l.expires_on
  from notif_audience a
  join public.stock_lots l
    on l.organization_id is not distinct from a.organization_id and l.owner_user_id is not distinct from a.owner_user_id
  join public.stock_items i on i.id = l.item_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and i.archived_at is null and l.quantity_remaining > 0 and l.expires_on is not null and l.expires_on < p_today
    and not ('stock_expired' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  return v_count;
end;
$$;
revoke all on function private.generate_notifications(date, uuid) from public, anon, authenticated;
