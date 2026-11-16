-- ANEN · Fase 2 · Finanças pessoais e empresariais
-- Cada registo pertence a UM âmbito: uma organização (organization_id) ou uma pessoa (owner_user_id).
-- Valores monetários em unidades mínimas (bigint), sempre com moeda. Limite 2^53-1 para
-- serem representáveis sem perda em JSON/JavaScript.

insert into public.permissions (key, module, description) values
  ('finance.read', 'finance', 'Consultar contas, movimentos e relatórios'),
  ('finance.write', 'finance', 'Registar e alterar movimentos, contas, orçamentos e objetivos');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p on p.key in ('finance.read', 'finance.write')
where r.organization_id is null and (
  r.key in ('owner', 'admin', 'manager', 'accountant')
  or (r.key = 'viewer' and p.key = 'finance.read')
);

-- Acesso a um âmbito financeiro: organização (por permissão) ou pessoal (o próprio).
create or replace function private.can_access_finance(p_org uuid, p_owner uuid, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is not null and p_owner is null then
      private.has_org_permission(p_org, case when p_write then 'finance.write' else 'finance.read' end)
    when p_org is null and p_owner is not null then
      p_owner = (select auth.uid())
    else false
  end;
$$;
revoke all on function private.can_access_finance(uuid, uuid, boolean) from public;
grant execute on function private.can_access_finance(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('checking', 'savings', 'cash', 'credit_card', 'investment', 'other')),
  currency_code char(3) not null references public.currencies (code),
  opening_balance_minor bigint not null default 0 check (abs(opening_balance_minor) <= 9007199254740991),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_accounts_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index financial_accounts_org_idx on public.financial_accounts (organization_id);
create index financial_accounts_owner_idx on public.financial_accounts (owner_user_id);

create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  key text check (key ~ '^[a-z_]{2,40}$'),
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default '#737373' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint transaction_categories_scope check (
    (is_system and organization_id is null and owner_user_id is null and key is not null)
    or (not is_system and ((organization_id is null) <> (owner_user_id is null)))
  )
);
create unique index transaction_categories_system_key_idx on public.transaction_categories (key) where is_system;
create index transaction_categories_org_idx on public.transaction_categories (organization_id);
create index transaction_categories_owner_idx on public.transaction_categories (owner_user_id);

create table public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete cascade,
  category_id uuid references public.transaction_categories (id) on delete set null,
  kind text not null check (kind in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  counterparty text check (char_length(counterparty) <= 120),
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  interval_count smallint not null default 1 check (interval_count between 1 and 12),
  start_on date not null,
  end_on date,
  next_run_on date not null,
  occurrence_count integer not null default 0 check (occurrence_count >= 0),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_scope check ((organization_id is null) <> (owner_user_id is null)),
  constraint recurring_dates check (end_on is null or end_on >= start_on)
);
create index recurring_due_idx on public.recurring_transactions (next_run_on) where is_active;
create index recurring_org_idx on public.recurring_transactions (organization_id);
create index recurring_owner_idx on public.recurring_transactions (owner_user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete restrict,
  category_id uuid references public.transaction_categories (id) on delete set null,
  kind text not null check (kind in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  occurred_on date not null,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  counterparty text check (char_length(counterparty) <= 120),
  notes text check (char_length(notes) <= 1000),
  recurring_id uuid references public.recurring_transactions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index transactions_org_date_idx on public.transactions (organization_id, occurred_on desc) where organization_id is not null;
create index transactions_owner_date_idx on public.transactions (owner_user_id, occurred_on desc) where owner_user_id is not null;
create index transactions_account_idx on public.transactions (account_id);
create index transactions_category_idx on public.transactions (category_id);
create unique index transactions_recurring_once_idx on public.transactions (recurring_id, occurred_on) where recurring_id is not null;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  category_id uuid not null references public.transaction_categories (id) on delete cascade,
  period_start date not null check (extract(day from period_start) = 1),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index budgets_org_unique on public.budgets (organization_id, category_id, period_start, currency_code) where organization_id is not null;
create unique index budgets_owner_unique on public.budgets (owner_user_id, category_id, period_start, currency_code) where owner_user_id is not null;

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  target_minor bigint not null check (target_minor > 0 and target_minor <= 9007199254740991),
  saved_minor bigint not null default 0 check (saved_minor >= 0 and saved_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  target_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_goals_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index savings_goals_org_idx on public.savings_goals (organization_id);
create index savings_goals_owner_idx on public.savings_goals (owner_user_id);

-- ---------------------------------------------------------------------------
-- Integridade entre âmbitos: conta e categoria têm de ser do mesmo âmbito
-- ---------------------------------------------------------------------------
create or replace function private.validate_finance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc public.financial_accounts%rowtype;
  v_cat public.transaction_categories%rowtype;
  v_kind text;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    if new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'recurring_transactions' and tg_op = 'INSERT' then
    new.next_run_on := new.start_on;
    new.occurrence_count := 0;
  end if;

  if tg_table_name in ('transactions', 'recurring_transactions') then
    select * into v_acc from public.financial_accounts a where a.id = new.account_id;
    if not found
       or v_acc.organization_id is distinct from new.organization_id
       or v_acc.owner_user_id is distinct from new.owner_user_id then
      raise exception 'account_invalid' using errcode = '22023';
    end if;
    if v_acc.archived_at is not null and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
      raise exception 'account_archived' using errcode = '22023';
    end if;
    new.currency_code := v_acc.currency_code;
  end if;

  if tg_table_name in ('transactions', 'recurring_transactions', 'budgets') then
   if (to_jsonb(new) ->> 'category_id') is not null then
    select * into v_cat from public.transaction_categories c where c.id = (to_jsonb(new) ->> 'category_id')::uuid;
    if tg_table_name = 'budgets' then
      v_kind := 'expense';
    else
      v_kind := to_jsonb(new) ->> 'kind';
    end if;
    if not found or v_cat.kind <> v_kind or not (
      v_cat.is_system
      or (v_cat.organization_id is not distinct from new.organization_id and v_cat.owner_user_id is not distinct from new.owner_user_id)
    ) then
      raise exception 'category_invalid' using errcode = '22023';
    end if;
   end if;
  end if;

  if tg_table_name in ('transactions', 'recurring_transactions', 'budgets', 'savings_goals') then
    if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
      raise exception 'unsupported_reference' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_finance_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
      raise exception 'unsupported_reference' using errcode = '22023';
    end if;
  else
    new.created_by := old.created_by;
    if new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    -- A moeda de uma conta com movimentos não muda (os valores deixariam de fazer sentido).
    if new.currency_code <> old.currency_code and exists (select 1 from public.transactions t where t.account_id = old.id) then
      raise exception 'account_currency_locked' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger financial_accounts_validate before insert or update on public.financial_accounts
  for each row execute function private.validate_finance_account();
create trigger transactions_validate before insert or update on public.transactions
  for each row execute function private.validate_finance_row();
create trigger recurring_validate before insert or update on public.recurring_transactions
  for each row execute function private.validate_finance_row();
create trigger budgets_validate before insert or update on public.budgets
  for each row execute function private.validate_finance_row();
create trigger savings_goals_validate before insert or update on public.savings_goals
  for each row execute function private.validate_finance_row();

create trigger financial_accounts_updated_at before update on public.financial_accounts for each row execute function private.set_updated_at();
create trigger transactions_updated_at before update on public.transactions for each row execute function private.set_updated_at();
create trigger recurring_updated_at before update on public.recurring_transactions for each row execute function private.set_updated_at();
create trigger budgets_updated_at before update on public.budgets for each row execute function private.set_updated_at();
create trigger savings_goals_updated_at before update on public.savings_goals for each row execute function private.set_updated_at();

create trigger financial_accounts_audit after insert or update or delete on public.financial_accounts
  for each row execute function private.audit_row_change();
create trigger transactions_audit after update or delete on public.transactions
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.financial_accounts enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['financial_accounts', 'recurring_transactions', 'transactions', 'budgets', 'savings_goals'] loop
    execute format('create policy "finance read" on public.%I for select to authenticated using (private.can_access_finance(organization_id, owner_user_id, false))', t);
    execute format('create policy "finance insert" on public.%I for insert to authenticated with check (private.can_access_finance(organization_id, owner_user_id, true))', t);
    execute format('create policy "finance update" on public.%I for update to authenticated using (private.can_access_finance(organization_id, owner_user_id, true)) with check (private.can_access_finance(organization_id, owner_user_id, true))', t);
    execute format('create policy "finance delete" on public.%I for delete to authenticated using (private.can_access_finance(organization_id, owner_user_id, true))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
end;
$$;

create policy "categories read" on public.transaction_categories for select to authenticated
  using (is_system or private.can_access_finance(organization_id, owner_user_id, false));
create policy "categories insert" on public.transaction_categories for insert to authenticated
  with check (not is_system and private.can_access_finance(organization_id, owner_user_id, true));
create policy "categories update" on public.transaction_categories for update to authenticated
  using (not is_system and private.can_access_finance(organization_id, owner_user_id, true))
  with check (not is_system and private.can_access_finance(organization_id, owner_user_id, true));
create policy "categories delete" on public.transaction_categories for delete to authenticated
  using (not is_system and private.can_access_finance(organization_id, owner_user_id, true));
revoke all on public.transaction_categories from anon;
revoke truncate on public.transaction_categories from authenticated;

-- Colunas de sistema não editáveis pelos clientes
revoke update on public.transactions from authenticated;
grant update (account_id, category_id, kind, amount_minor, occurred_on, description, counterparty, notes) on public.transactions to authenticated;
revoke update on public.transaction_categories from authenticated;
grant update (name, color, archived_at) on public.transaction_categories to authenticated;

-- ---------------------------------------------------------------------------
-- Relatórios (SECURITY INVOKER: o RLS do utilizador aplica-se)
-- p_org null = âmbito pessoal
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
         coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)::bigint
  from public.transactions t
  where ((p_org is null and t.owner_user_id = (select auth.uid())) or (p_org is not null and t.organization_id = p_org))
    and t.occurred_on between p_from and p_to
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
  select t.category_id, t.currency_code, sum(t.amount_minor)::bigint, count(*)::bigint
  from public.transactions t
  where ((p_org is null and t.owner_user_id = (select auth.uid())) or (p_org is not null and t.organization_id = p_org))
    and t.occurred_on between p_from and p_to
    and t.kind = p_kind
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
          + coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0)
          - coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0))::bigint
  from public.financial_accounts a
  left join public.transactions t on t.account_id = a.id
  where (p_org is null and a.owner_user_id = (select auth.uid())) or (p_org is not null and a.organization_id = p_org)
  group by a.id;
$$;

-- Gera os movimentos recorrentes vencidos até p_until (idempotente: um por recorrência e data).
create or replace function public.materialize_recurring(p_org uuid, p_until date default current_date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_transactions%rowtype;
  v_created integer := 0;
  v_guard integer := 0;
  v_step interval;
begin
  for r in
    select * from public.recurring_transactions rt
    where rt.is_active and rt.next_run_on <= p_until
      and ((p_org is null and rt.owner_user_id = (select auth.uid())) or (p_org is not null and rt.organization_id = p_org))
    for update skip locked
  loop
    v_step := case r.frequency
      when 'weekly' then make_interval(weeks => r.interval_count)
      when 'monthly' then make_interval(months => r.interval_count)
      else make_interval(years => r.interval_count) end;
    while r.next_run_on <= p_until and (r.end_on is null or r.next_run_on <= r.end_on) and v_guard < 1000 loop
      insert into public.transactions (organization_id, owner_user_id, account_id, category_id, kind, amount_minor, currency_code,
                                       occurred_on, description, counterparty, recurring_id)
      values (r.organization_id, r.owner_user_id, r.account_id, r.category_id, r.kind, r.amount_minor, r.currency_code,
              r.next_run_on, r.description, r.counterparty, r.id)
      on conflict do nothing;
      if found then v_created := v_created + 1; end if;
      -- Contador próprio: apagar uma ocorrência gerada não a faz reaparecer. A data é sempre
      -- calculada a partir do início para não acumular desvios de fim de mês (31 → 28 → 28…).
      r.occurrence_count := r.occurrence_count + 1;
      r.next_run_on := (r.start_on + v_step * r.occurrence_count)::date;
      v_guard := v_guard + 1;
    end loop;
    update public.recurring_transactions
    set next_run_on = r.next_run_on,
        occurrence_count = r.occurrence_count,
        is_active = (r.end_on is null or r.next_run_on <= r.end_on)
    where id = r.id;
  end loop;
  return v_created;
end;
$$;

revoke all on function public.finance_monthly(uuid, date, date) from public, anon;
revoke all on function public.finance_by_category(uuid, date, date, text) from public, anon;
revoke all on function public.account_balances(uuid) from public, anon;
revoke all on function public.materialize_recurring(uuid, date) from public, anon;
grant execute on function public.finance_monthly(uuid, date, date) to authenticated;
grant execute on function public.finance_by_category(uuid, date, date, text) to authenticated;
grant execute on function public.account_balances(uuid) to authenticated;
grant execute on function public.materialize_recurring(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Categorias de sistema (nomes traduzidos na interface pela chave)
-- ---------------------------------------------------------------------------
insert into public.transaction_categories (key, kind, name, color, is_system) values
  ('sales', 'income', 'Vendas', '#E06A10', true),
  ('services', 'income', 'Serviços prestados', '#E06A10', true),
  ('salary', 'income', 'Salário', '#E06A10', true),
  ('investments_income', 'income', 'Rendimentos de investimentos', '#E06A10', true),
  ('other_income', 'income', 'Outras receitas', '#E06A10', true),
  ('materials', 'expense', 'Materiais', '#5B8DEF', true),
  ('labor', 'expense', 'Mão de obra', '#5B8DEF', true),
  ('rent', 'expense', 'Renda / aluguel', '#5B8DEF', true),
  ('utilities', 'expense', 'Energia, água e gás', '#5B8DEF', true),
  ('fuel_transport', 'expense', 'Combustível e transportes', '#5B8DEF', true),
  ('food', 'expense', 'Alimentação', '#5B8DEF', true),
  ('taxes', 'expense', 'Impostos e taxas', '#5B8DEF', true),
  ('marketing', 'expense', 'Marketing', '#5B8DEF', true),
  ('software', 'expense', 'Software e subscrições', '#5B8DEF', true),
  ('equipment', 'expense', 'Equipamentos', '#5B8DEF', true),
  ('health', 'expense', 'Saúde', '#5B8DEF', true),
  ('education', 'expense', 'Educação', '#5B8DEF', true),
  ('leisure', 'expense', 'Lazer', '#5B8DEF', true),
  ('other_expense', 'expense', 'Outras despesas', '#5B8DEF', true);
