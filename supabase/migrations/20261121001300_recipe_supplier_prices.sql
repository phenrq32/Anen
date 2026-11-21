-- Prompt 03 · Fase 5: fichas técnicas ligadas aos preços de ingredientes registados.
--
-- Um ingrediente pode indicar o preço de fornecedor (supplier_prices) de onde vem o preço da compra.
-- O ingrediente guarda o preço usado (package_price_minor) como fotografia: o custo da ficha não muda
-- sozinho quando chega um preço novo. A função recipe_price_updates mostra o que mudou desde então,
-- e o utilizador decide atualizar (cada gravação fica em recipe_cost_history).
--
-- package_quantity continua a dizer quantas unidades da receita (g, ml, un…) vêm numa unidade do
-- fornecedor (1 kg = 1000 g); a conversão é feita pelo motor quando as unidades são conhecidas.

alter table public.recipe_ingredients
  add column supplier_price_id uuid references public.supplier_prices (id) on delete set null;
create index recipe_ingredients_supplier_price_idx on public.recipe_ingredients (supplier_price_id) where supplier_price_id is not null;

-- O preço ligado tem de ser do mesmo âmbito e da mesma moeda da ficha.
create or replace function private.validate_recipe_ingredient_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supplier_price_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.supplier_price_id is not distinct from old.supplier_price_id then
    return new;
  end if;
  if not exists (
    select 1 from public.recipes r
    join public.supplier_prices sp on sp.id = new.supplier_price_id
    where r.id = new.recipe_id
      and sp.organization_id is not distinct from r.organization_id
      and sp.owner_user_id is not distinct from r.owner_user_id
      and sp.currency_code = r.currency_code
  ) then
    raise exception 'supplier_price_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger recipe_ingredients_price before insert or update on public.recipe_ingredients
  for each row execute function private.validate_recipe_ingredient_price();

-- Gravação: parte da versão da migration 0500 e acrescenta a ligação (omissa = sem ligação).
-- Uma ligação NOVA exige poder ler os preços de fornecedores (business.read): quem só tem quotes.write
-- não liga preços que não vê, mas continua a poder gravar uma ficha com ligações feitas por outra pessoa.
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
  delete from public.recipe_ingredients where recipe_id = p_recipe_id;
  insert into public.recipe_ingredients (recipe_id, position, name, quantity, unit, package_quantity, package_price_minor, waste_percent, cost_minor,
                                         supplier_price_id)
  select p_recipe_id, x.position, x.name, x.quantity, x.unit, x.package_quantity, x.package_price_minor, x.waste_percent, x.cost_minor,
         nullif(x.supplier_price_id, '')::uuid
  from jsonb_to_recordset(coalesce(p_ingredients, '[]'::jsonb))
    as x(position smallint, name text, quantity numeric, unit text, package_quantity numeric, package_price_minor bigint, waste_percent numeric,
         cost_minor bigint, supplier_price_id text);
  insert into public.recipe_cost_history (recipe_id, cost_per_portion_minor, ingredient_cost_per_portion_minor)
  values (p_recipe_id, (p_fields ->> 'cost_per_portion_minor')::bigint, (p_fields ->> 'ingredient_cost_per_portion_minor')::bigint);
end;
$$;
revoke all on function public.save_recipe_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_recipe_content(uuid, jsonb, jsonb) to authenticated;

-- Ingredientes ligados cujo preço já não é o mais recente do mesmo artigo no mesmo fornecedor
-- (nome normalizado + unidade + moeda, como o motor summarizePriceHistory), ou cujo registo foi corrigido.
-- SECURITY INVOKER: o RLS das fichas (quotes.read) e dos preços (business.read) aplica-se.
create or replace function public.recipe_price_updates(p_recipe_id uuid default null)
returns table (
  recipe_id uuid,
  ingredient_id uuid,
  linked_price_id uuid,
  used_price_minor bigint,
  latest_price_id uuid,
  latest_price_minor bigint,
  latest_unit text,
  latest_observed_on date,
  supplier_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select ri.recipe_id, ri.id, ri.supplier_price_id, ri.package_price_minor,
         latest.id, latest.unit_price_minor, latest.unit, latest.observed_on, c.name
  from public.recipe_ingredients ri
  join public.supplier_prices linked on linked.id = ri.supplier_price_id
  join public.contacts c on c.id = linked.contact_id
  cross join lateral (
    select sp.id, sp.unit_price_minor, sp.unit, sp.observed_on
    from public.supplier_prices sp
    where sp.contact_id = linked.contact_id
      and sp.currency_code = linked.currency_code
      and lower(regexp_replace(btrim(sp.item_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(linked.item_name), '\s+', ' ', 'g'))
      and lower(coalesce(btrim(sp.unit), '')) = lower(coalesce(btrim(linked.unit), ''))
    order by sp.observed_on desc, sp.created_at desc
    limit 1
  ) latest
  where (p_recipe_id is null or ri.recipe_id = p_recipe_id)
    and (latest.id <> ri.supplier_price_id or latest.unit_price_minor <> ri.package_price_minor);
$$;
revoke all on function public.recipe_price_updates(uuid) from public, anon;
grant execute on function public.recipe_price_updates(uuid) to authenticated;
