-- ANEN · Prompt 02 · Fase A · Integração financeira
-- Clientes e fornecedores, centros de custo e projetos; movimentos ligados a contacto, projeto,
-- centro de custo e tipo de custo; vencimentos, impostos e pagamentos parciais.
-- Os relatórios de caixa (saldo, resumo mensal, por categoria) passam a usar o valor liquidado.

insert into public.permissions (key, module, description) values
  ('business.read', 'business', 'Consultar clientes, fornecedores, projetos e centros de custo'),
  ('business.write', 'business', 'Criar e alterar clientes, fornecedores, projetos e centros de custo');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in ('business.read', 'business.write')
where r.organization_id is null and (
  r.key in ('owner', 'admin', 'manager', 'employee')
  or (r.key in ('accountant', 'viewer') and p.key = 'business.read')
);

create or replace function private.can_access_business(p_org uuid, p_owner uuid, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is not null and p_owner is null then
      private.has_org_permission(p_org, case when p_write then 'business.write' else 'business.read' end)
    when p_org is null and p_owner is not null then p_owner = (select auth.uid())
    else false
  end;
$$;
revoke all on function private.can_access_business(uuid, uuid, boolean) from public;
grant execute on function private.can_access_business(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('client', 'supplier', 'both')),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  tax_id text check (char_length(tax_id) <= 32),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  address text check (char_length(address) <= 400),
  payment_terms_days smallint check (payment_terms_days between 0 and 365),
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index contacts_org_idx on public.contacts (organization_id, name);
create index contacts_owner_idx on public.contacts (owner_user_id, name);

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_centers_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index cost_centers_org_idx on public.cost_centers (organization_id);
create index cost_centers_owner_idx on public.cost_centers (owner_user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  client_contact_id uuid references public.contacts (id) on delete set null,
  quote_id uuid unique references public.quotes (id) on delete set null,
  status text not null default 'active' check (status in ('planned', 'active', 'completed', 'cancelled')),
  currency_code char(3) not null references public.currencies (code),
  planned_cost_minor bigint not null default 0 check (planned_cost_minor between 0 and 9007199254740991),
  planned_revenue_minor bigint not null default 0 check (planned_revenue_minor between 0 and 9007199254740991),
  start_on date,
  end_on date,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_scope check ((organization_id is null) <> (owner_user_id is null)),
  constraint projects_dates check (end_on is null or start_on is null or end_on >= start_on)
);
create index projects_org_idx on public.projects (organization_id, created_at desc);
create index projects_owner_idx on public.projects (owner_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Movimentos: ligações, vencimento, impostos e liquidação
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column contact_id uuid references public.contacts (id) on delete set null,
  add column project_id uuid references public.projects (id) on delete set null,
  add column cost_center_id uuid references public.cost_centers (id) on delete set null,
  add column cost_kind text check (cost_kind in ('material', 'labor', 'travel', 'equipment', 'overhead', 'other')),
  add column due_on date,
  add column net_minor bigint check (net_minor between 0 and 9007199254740991),
  add column tax_minor bigint check (tax_minor between 0 and 9007199254740991),
  add column settled_minor bigint,
  add column payment_method text check (payment_method in ('cash', 'card', 'transfer', 'direct_debit', 'mbway', 'pix', 'boleto', 'check', 'other')),
  add column document_ref text check (char_length(document_ref) <= 120);

-- Movimentos existentes: considerados liquidados (era o comportamento até agora).
-- Sem triggers, para não gerar auditoria nem revalidar linhas antigas.
alter table public.transactions disable trigger user;
update public.transactions set settled_minor = amount_minor;
alter table public.transactions enable trigger user;

alter table public.transactions
  alter column settled_minor set not null,
  add constraint transactions_settled_range check (settled_minor between 0 and amount_minor),
  add constraint transactions_tax_split check (
    (net_minor is null and tax_minor is null)
    or (net_minor is not null and tax_minor is not null and net_minor + tax_minor = amount_minor)
  ),
  add column payment_status text generated always as (
    case when settled_minor = 0 then 'pending' when settled_minor < amount_minor then 'partial' else 'paid' end
  ) stored;

create index transactions_project_idx on public.transactions (project_id) where project_id is not null;
create index transactions_contact_idx on public.transactions (contact_id) where contact_id is not null;
create index transactions_open_idx on public.transactions (organization_id, owner_user_id, due_on) where settled_minor < amount_minor;

-- Contacto, projeto e centro de custo têm de ser do mesmo âmbito; o projeto, da mesma moeda.
-- Liquidação por omissão: o valor total (um movimento sem indicação é um movimento pago).
create or replace function private.validate_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  if tg_op = 'INSERT' then
    new.settled_minor := coalesce(new.settled_minor, new.amount_minor);
  elsif new.settled_minor is null
     or (new.settled_minor = old.settled_minor and old.settled_minor = old.amount_minor) then
    -- Estava pago e o valor mudou sem indicação de liquidação: continua pago.
    new.settled_minor := new.amount_minor;
  end if;
  -- Valor reduzido abaixo do já liquidado: fica totalmente liquidado.
  if new.settled_minor > new.amount_minor then
    new.settled_minor := new.amount_minor;
  end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id
      and c.organization_id is not distinct from new.organization_id
      and c.owner_user_id is not distinct from new.owner_user_id
  ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;

  if new.cost_center_id is not null and not exists (
    select 1 from public.cost_centers c
    where c.id = new.cost_center_id
      and c.organization_id is not distinct from new.organization_id
      and c.owner_user_id is not distinct from new.owner_user_id
  ) then
    raise exception 'cost_center_invalid' using errcode = '22023';
  end if;

  if new.project_id is not null then
    select a.currency_code into v_currency from public.financial_accounts a where a.id = new.account_id;
    if not exists (
      select 1 from public.projects p
      where p.id = new.project_id
        and p.organization_id is not distinct from new.organization_id
        and p.owner_user_id is not distinct from new.owner_user_id
    ) then
      raise exception 'project_invalid' using errcode = '22023';
    end if;
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.currency_code = v_currency) then
      raise exception 'project_currency_mismatch' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

-- Nome ordenado antes de transactions_validate: corre primeiro, mas usa a moeda da conta diretamente.
create trigger transactions_links before insert or update on public.transactions
  for each row execute function private.validate_transaction_links();

revoke update on public.transactions from authenticated;
grant update (account_id, category_id, kind, amount_minor, occurred_on, description, counterparty, notes,
  contact_id, project_id, cost_center_id, cost_kind, due_on, net_minor, tax_minor, settled_minor, payment_method, document_ref)
  on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- Integridade dos projetos
-- ---------------------------------------------------------------------------
create or replace function private.validate_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.client_contact_id
      and c.organization_id is not distinct from new.organization_id
      and c.owner_user_id is not distinct from new.owner_user_id
  ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  if new.quote_id is not null and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) and not exists (
    select 1 from public.quotes q
    where q.id = new.quote_id
      and q.organization_id is not distinct from new.organization_id
      and q.owner_user_id is not distinct from new.owner_user_id
      and q.currency_code = new.currency_code
  ) then
    raise exception 'quote_invalid' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
      raise exception 'unsupported_reference' using errcode = '22023';
    end if;
  elsif new.currency_code <> old.currency_code and exists (select 1 from public.transactions t where t.project_id = old.id) then
    raise exception 'project_currency_locked' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger contacts_scope before insert or update on public.contacts for each row execute function private.set_creator_and_lock_scope();
create trigger cost_centers_scope before insert or update on public.cost_centers for each row execute function private.set_creator_and_lock_scope();
create trigger projects_scope before insert or update on public.projects for each row execute function private.set_creator_and_lock_scope();
create trigger projects_validate before insert or update on public.projects for each row execute function private.validate_project();
create trigger contacts_updated_at before update on public.contacts for each row execute function private.set_updated_at();
create trigger cost_centers_updated_at before update on public.cost_centers for each row execute function private.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function private.set_updated_at();
create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function private.audit_row_change();
create trigger projects_audit after insert or update or delete on public.projects for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.cost_centers enable row level security;
alter table public.projects enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'cost_centers', 'projects'] loop
    execute format('create policy "business read" on public.%I for select to authenticated using (private.can_access_business(organization_id, owner_user_id, false))', t);
    execute format('create policy "business insert" on public.%I for insert to authenticated with check (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('create policy "business update" on public.%I for update to authenticated using (private.can_access_business(organization_id, owner_user_id, true)) with check (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('create policy "business delete" on public.%I for delete to authenticated using (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
end;
$$;

revoke update on public.contacts from authenticated;
grant update (kind, name, tax_id, email, phone, address, payment_terms_days, notes, archived_at) on public.contacts to authenticated;
revoke update on public.cost_centers from authenticated;
grant update (name, archived_at) on public.cost_centers to authenticated;
revoke update on public.projects from authenticated;
grant update (name, client_contact_id, status, planned_cost_minor, planned_revenue_minor, start_on, end_on, notes)
  on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- Relatórios de caixa: passam a contar o valor liquidado
-- ---------------------------------------------------------------------------
create or replace function public.finance_monthly(p_org uuid, p_from date, p_to date)
returns table (month date, currency_code char(3), income bigint, expense bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', t.occurred_on)::date as month,
         t.currency_code,
         coalesce(sum(t.settled_minor) filter (where t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.settled_minor) filter (where t.kind = 'expense'), 0)::bigint
  from public.transactions t
  where ((p_org is null and t.owner_user_id = (select auth.uid())) or (p_org is not null and t.organization_id = p_org))
    and t.occurred_on between p_from and p_to
    and t.settled_minor > 0
  group by 1, 2
  order by 1, 2;
$$;

create or replace function public.finance_by_category(p_org uuid, p_from date, p_to date, p_kind text)
returns table (category_id uuid, currency_code char(3), total bigint, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.currency_code, sum(t.settled_minor)::bigint, count(*)::bigint
  from public.transactions t
  where ((p_org is null and t.owner_user_id = (select auth.uid())) or (p_org is not null and t.organization_id = p_org))
    and t.occurred_on between p_from and p_to
    and t.kind = p_kind
    and t.settled_minor > 0
  group by 1, 2
  order by 3 desc;
$$;

create or replace function public.account_balances(p_org uuid)
returns table (account_id uuid, currency_code char(3), balance_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.currency_code,
         (a.opening_balance_minor
          + coalesce(sum(t.settled_minor) filter (where t.kind = 'income'), 0)
          - coalesce(sum(t.settled_minor) filter (where t.kind = 'expense'), 0))::bigint
  from public.financial_accounts a
  left join public.transactions t on t.account_id = a.id
  where (p_org is null and a.owner_user_id = (select auth.uid())) or (p_org is not null and a.organization_id = p_org)
  group by a.id;
$$;

-- ---------------------------------------------------------------------------
-- Projeto a partir de um orçamento aceite (idempotente). SECURITY INVOKER: o RLS aplica-se.
-- ---------------------------------------------------------------------------
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

  if nullif(btrim(coalesce(v_quote.client_name, '')), '') is not null then
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
