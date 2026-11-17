-- ANEN · Prompt 03 · Fase 3 · CRM
-- 1. Observações datadas por contacto (nota, chamada, reunião, email, visita).
-- 2. Histórico de preços por fornecedor: preço unitário observado numa data, opcionalmente
--    ligado à despesa (movimento) que o comprova. Sem preços de mercado: só o que o utilizador regista.
-- 3. Orçamentos ligados ao cadastro de clientes (client_contact_id), para que a ficha do cliente
--    mostre os orçamentos. Os campos de texto do cliente continuam no orçamento (documento imutável).

-- ---------------------------------------------------------------------------
-- 1. Observações
-- ---------------------------------------------------------------------------
create table public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'call', 'meeting', 'email', 'visit')),
  noted_on date not null default current_date,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_notes_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index contact_notes_contact_idx on public.contact_notes (contact_id, noted_on desc, created_at desc);
create index contact_notes_org_idx on public.contact_notes (organization_id) where organization_id is not null;
create index contact_notes_owner_idx on public.contact_notes (owner_user_id) where owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Preços por fornecedor
-- ---------------------------------------------------------------------------
create table public.supplier_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  item_name text not null check (char_length(btrim(item_name)) between 1 and 160),
  unit text check (char_length(unit) <= 20),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  observed_on date not null,
  transaction_id uuid references public.transactions (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_prices_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index supplier_prices_contact_idx on public.supplier_prices (contact_id, observed_on desc);
create index supplier_prices_org_item_idx on public.supplier_prices (organization_id, lower(item_name)) where organization_id is not null;
create index supplier_prices_owner_item_idx on public.supplier_prices (owner_user_id, lower(item_name)) where owner_user_id is not null;

-- O contacto tem de ser do mesmo âmbito e não pode mudar; nos preços, tem de ser fornecedor.
create or replace function private.validate_contact_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.contact_id <> old.contact_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id
      and c.organization_id is not distinct from new.organization_id
      and c.owner_user_id is not distinct from new.owner_user_id
      and (tg_table_name <> 'supplier_prices' or c.kind in ('supplier', 'both'))
  ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.validate_supplier_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.item_name := btrim(new.item_name);
  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  if (tg_op = 'INSERT' or new.currency_code <> old.currency_code)
     and not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  -- O movimento que comprova o preço: mesma pessoa/organização, mesmo contacto, despesa, mesma moeda.
  if new.transaction_id is not null and not exists (
    select 1 from public.transactions t
    where t.id = new.transaction_id
      and t.organization_id is not distinct from new.organization_id
      and t.owner_user_id is not distinct from new.owner_user_id
      and t.kind = 'expense'
      and t.contact_id = new.contact_id
      and t.currency_code = new.currency_code
  ) then
    raise exception 'transaction_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger contact_notes_scope before insert or update on public.contact_notes for each row execute function private.set_creator_and_lock_scope();
create trigger contact_notes_contact before insert or update on public.contact_notes for each row execute function private.validate_contact_child();
create trigger contact_notes_updated_at before update on public.contact_notes for each row execute function private.set_updated_at();
create trigger supplier_prices_scope before insert or update on public.supplier_prices for each row execute function private.set_creator_and_lock_scope();
create trigger supplier_prices_contact before insert or update on public.supplier_prices for each row execute function private.validate_contact_child();
create trigger supplier_prices_validate before insert or update on public.supplier_prices for each row execute function private.validate_supplier_price();
create trigger supplier_prices_updated_at before update on public.supplier_prices for each row execute function private.set_updated_at();
create trigger supplier_prices_audit after insert or update or delete on public.supplier_prices for each row execute function private.audit_row_change();

alter table public.contact_notes enable row level security;
alter table public.supplier_prices enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['contact_notes', 'supplier_prices'] loop
    execute format('create policy "business read" on public.%I for select to authenticated using (private.can_access_business(organization_id, owner_user_id, false))', t);
    execute format('create policy "business insert" on public.%I for insert to authenticated with check (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('create policy "business update" on public.%I for update to authenticated using (private.can_access_business(organization_id, owner_user_id, true)) with check (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('create policy "business delete" on public.%I for delete to authenticated using (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
    execute format('revoke update on public.%I from authenticated', t);
  end loop;
end;
$$;
grant update (kind, noted_on, body) on public.contact_notes to authenticated;
grant update (item_name, unit, unit_price_minor, currency_code, observed_on, transaction_id, notes) on public.supplier_prices to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Orçamento ligado ao cliente
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column client_contact_id uuid references public.contacts (id) on delete set null;
create index quotes_client_contact_idx on public.quotes (client_contact_id) where client_contact_id is not null;

create or replace function private.validate_quote_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_contact_id is not null
     and (tg_op = 'INSERT' or new.client_contact_id is distinct from old.client_contact_id)
     and not exists (
       select 1 from public.contacts c
       where c.id = new.client_contact_id
         and c.organization_id is not distinct from new.organization_id
         and c.owner_user_id is not distinct from new.owner_user_id
         and c.kind in ('client', 'both')
     ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger quotes_contact before insert or update on public.quotes
  for each row execute function private.validate_quote_contact();

-- O cliente ligado também fica bloqueado depois de aceite, recusado, expirado ou cancelado.
-- Exceção: o contacto apagado (on delete set null) não pode impedir o apagamento.
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
       new.total_cost_minor, new.price_before_tax_minor, new.tax_minor, new.total_minor
     ) is distinct from (
       old.title, old.description, old.client_name, old.client_email, old.client_tax_id, old.client_address,
       old.currency_code, old.valid_until, old.margin_percent, old.tax_rate_percent, old.tax_label, old.conditions,
       old.total_cost_minor, old.price_before_tax_minor, old.tax_minor, old.total_minor
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

revoke update on public.quotes from authenticated;
grant update (title, description, client_contact_id, client_name, client_email, client_tax_id, client_address, currency_code, status,
  valid_until, margin_percent, tax_rate_percent, tax_label, conditions, total_cost_minor, price_before_tax_minor, tax_minor, total_minor)
  on public.quotes to authenticated;

-- Projeto a partir de orçamento: usa o cliente ligado; só procura pelo nome quando não há ligação.
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

  insert into public.projects (organization_id, owner_user_id, name, client_contact_id, quote_id, status, currency_code,
                               planned_cost_minor, planned_revenue_minor)
  values (v_quote.organization_id, v_quote.owner_user_id, v_quote.title, v_contact, v_quote.id, 'active', v_quote.currency_code,
          v_quote.total_cost_minor, v_quote.price_before_tax_minor)
  returning id into v_project;
  return v_project;
end;
$$;
revoke all on function public.create_project_from_quote(uuid) from public, anon;
grant execute on function public.create_project_from_quote(uuid) to authenticated;

-- Orçamentos que já originaram um projeto com cliente: a ligação é um facto, não uma suposição por nome.
alter table public.quotes disable trigger user;
update public.quotes q set client_contact_id = p.client_contact_id
from public.projects p
where p.quote_id = q.id and p.client_contact_id is not null and q.client_contact_id is null;
alter table public.quotes enable trigger user;
