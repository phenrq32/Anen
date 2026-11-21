-- Prompt 03 · Fase 4: descontos nos orçamentos, produto/serviço nas linhas e descrição do projeto.
--
-- Desconto: um por orçamento, em percentagem OU valor fixo, aplicado ao preço sem imposto
-- (depois da margem). O imposto incide sobre o valor já descontado.
--   preço antes do desconto = price_before_tax_minor + discount_minor
-- O cálculo é do motor (@anen/financial-engine); a base de dados só guarda e valida a coerência.

alter table public.quotes
  add column discount_percent numeric(6, 3) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  add column discount_fixed_minor bigint not null default 0 check (discount_fixed_minor between 0 and 9007199254740991),
  add column discount_minor bigint not null default 0 check (discount_minor between 0 and 9007199254740991),
  add constraint quotes_discount_single check (discount_percent = 0 or discount_fixed_minor = 0);

-- Natureza do que se vende em cada linha (aparece no documento do cliente).
alter table public.quote_items
  add column nature text not null default 'service' check (nature in ('product', 'service'));

alter table public.quote_items disable trigger user;
update public.quote_items set nature = 'product' where kind in ('material', 'equipment');
alter table public.quote_items enable trigger user;

-- Descrição do projeto (âmbito do trabalho), distinta das notas internas.
alter table public.projects
  add column description text check (char_length(description) <= 4000);

revoke update on public.projects from authenticated;
grant update (name, description, client_contact_id, status, planned_cost_minor, planned_revenue_minor, start_on, end_on, notes)
  on public.projects to authenticated;

alter table public.projects disable trigger user;
update public.projects p set description = q.description
from public.quotes q
where p.quote_id = q.id and p.description is null and q.description is not null;
alter table public.projects enable trigger user;

-- Guarda: parte da última versão (migration 1100) e acrescenta o desconto ao conteúdo bloqueado.
create or replace function private.guard_quote_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id
     or new.number <> old.number
     or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Eliminação do autor (created_by -> NULL) não é uma edição de conteúdo nem de estado (migration 0600).
  if new.created_by is null and old.created_by is not null then
    return new;
  end if;
  if old.status not in ('draft', 'sent') and (
       new.title, new.description, new.client_name, new.client_email, new.client_tax_id, new.client_address,
       new.currency_code, new.valid_until, new.margin_percent, new.tax_rate_percent, new.tax_label, new.conditions,
       new.total_cost_minor, new.price_before_tax_minor, new.tax_minor, new.total_minor,
       new.discount_percent, new.discount_fixed_minor, new.discount_minor
     ) is distinct from (
       old.title, old.description, old.client_name, old.client_email, old.client_tax_id, old.client_address,
       old.currency_code, old.valid_until, old.margin_percent, old.tax_rate_percent, old.tax_label, old.conditions,
       old.total_cost_minor, old.price_before_tax_minor, old.tax_minor, old.total_minor,
       old.discount_percent, old.discount_fixed_minor, old.discount_minor
     ) then
    raise exception 'quote_locked' using errcode = '22023';
  end if;
  if old.status not in ('draft', 'sent') and new.client_contact_id is not null
     and new.client_contact_id is distinct from old.client_contact_id then
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

-- Gravação: parte da versão da migration 1100; campos novos opcionais (omissos = sem desconto, serviço).
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
    client_contact_id = nullif(p_fields ->> 'client_contact_id', '')::uuid,
    client_name = p_fields ->> 'client_name',
    client_email = p_fields ->> 'client_email',
    client_tax_id = p_fields ->> 'client_tax_id',
    client_address = p_fields ->> 'client_address',
    valid_until = (p_fields ->> 'valid_until')::date,
    margin_percent = (p_fields ->> 'margin_percent')::numeric,
    tax_rate_percent = (p_fields ->> 'tax_rate_percent')::numeric,
    tax_label = p_fields ->> 'tax_label',
    conditions = p_fields ->> 'conditions',
    discount_percent = coalesce((p_fields ->> 'discount_percent')::numeric, 0),
    discount_fixed_minor = coalesce((p_fields ->> 'discount_fixed_minor')::bigint, 0),
    discount_minor = coalesce((p_fields ->> 'discount_minor')::bigint, 0),
    total_cost_minor = (p_fields ->> 'total_cost_minor')::bigint,
    price_before_tax_minor = (p_fields ->> 'price_before_tax_minor')::bigint,
    tax_minor = (p_fields ->> 'tax_minor')::bigint,
    total_minor = (p_fields ->> 'total_minor')::bigint
  where id = p_quote_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.quote_items where quote_id = p_quote_id;
  insert into public.quote_items (quote_id, position, kind, nature, description, quantity, unit, unit_cost_minor, total_cost_minor)
  select p_quote_id, x.position, x.kind, coalesce(x.nature, 'service'), x.description, x.quantity, x.unit, x.unit_cost_minor, x.total_cost_minor
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(position smallint, kind text, nature text, description text, quantity numeric, unit text, unit_cost_minor bigint, total_cost_minor bigint);
  return public.snapshot_quote(p_quote_id);
end;
$$;
revoke all on function public.save_quote_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_quote_content(uuid, jsonb, jsonb) to authenticated;

revoke update on public.quotes from authenticated;
grant update (title, description, client_contact_id, client_name, client_email, client_tax_id, client_address, currency_code, status,
  valid_until, margin_percent, tax_rate_percent, tax_label, conditions, discount_percent, discount_fixed_minor, discount_minor,
  total_cost_minor, price_before_tax_minor, tax_minor, total_minor)
  on public.quotes to authenticated;

-- Projeto a partir de orçamento: parte da versão da migration 1100 e copia a descrição.
create or replace function public.create_project_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_project uuid;
  v_contact uuid;
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_quote.status <> 'accepted' then
    raise exception 'quote_not_accepted' using errcode = '22023';
  end if;
  select p.id into v_project from public.projects p where p.quote_id = p_quote_id;
  if found then
    return v_project;
  end if;

  v_contact := v_quote.client_contact_id;
  if v_contact is null and nullif(btrim(coalesce(v_quote.client_name, '')), '') is not null then
    select c.id into v_contact from public.contacts c
    where c.organization_id is not distinct from v_quote.organization_id
      and c.owner_user_id is not distinct from v_quote.owner_user_id
      and c.kind in ('client', 'both')
      and c.archived_at is null
      and lower(btrim(c.name)) = lower(btrim(v_quote.client_name))
    order by c.created_at
    limit 1;
    if v_contact is null then
      insert into public.contacts (organization_id, owner_user_id, kind, name, tax_id, email, address)
      values (v_quote.organization_id, v_quote.owner_user_id, 'client', btrim(v_quote.client_name),
              v_quote.client_tax_id, v_quote.client_email, v_quote.client_address)
      returning id into v_contact;
    end if;
  end if;

  -- A receita prevista é o preço sem imposto já com o desconto.
  insert into public.projects (organization_id, owner_user_id, name, description, client_contact_id, quote_id, status, currency_code,
                               planned_cost_minor, planned_revenue_minor)
  values (v_quote.organization_id, v_quote.owner_user_id, v_quote.title, v_quote.description, v_contact, v_quote.id, 'active',
          v_quote.currency_code, v_quote.total_cost_minor, v_quote.price_before_tax_minor)
  returning id into v_project;
  return v_project;
end;
$$;
revoke all on function public.create_project_from_quote(uuid) from public, anon;
grant execute on function public.create_project_from_quote(uuid) to authenticated;
