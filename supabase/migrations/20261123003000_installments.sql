-- Dual Workspace · Fase 5 (§5.6): despesas e receitas mensais com fim e parcelamentos.
--
-- Cada parcela é um movimento pendente (settled_minor = 0) ligado ao plano (installment_plan_id + número).
-- Assim aparece em "A receber e a pagar", nos avisos de vencimento, no mês certo e nas previsões, e
-- marca-se como paga como qualquer outro movimento. O plano guarda o que foi pedido.
--
-- Estados de cada parcela: prevista (por liquidar), paga (liquidada) e cancelada (número do plano sem
-- movimento, depois de cancel_installments). O cálculo das datas e valores é o de
-- packages/financial-engine/src/installments.ts (teste de paridade em installments.test.ts).
--
-- Reversão: drop function public.update_installments_from(uuid, integer, bigint, integer),
--   public.cancel_installments(uuid, integer), public.create_installment_plan(...),
--   private.installment_due(date, integer), private.guard_installment_link();
--   drop trigger transactions_installment_link on public.transactions;
--   alter table public.transactions drop column installment_plan_id, drop column installment_number;
--   drop table public.installment_plans;

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  account_id uuid not null references public.financial_accounts (id),
  category_id uuid references public.transaction_categories (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  currency_code char(3) not null references public.currencies (code),
  total_minor bigint not null check (total_minor > 0 and total_minor <= 9007199254740991),
  installment_count smallint not null check (installment_count between 1 and 360),
  due_day smallint not null check (due_day between 1 and 31),
  start_on date not null,
  first_due_on date not null,
  last_due_on date not null,
  cancelled_at timestamptz,
  cancelled_from smallint,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_plans_scope check ((organization_id is null) <> (owner_user_id is null)),
  constraint installment_plans_dates check (last_due_on >= first_due_on and first_due_on >= start_on)
);
create index installment_plans_org_idx on public.installment_plans (organization_id) where organization_id is not null;
create index installment_plans_owner_idx on public.installment_plans (owner_user_id) where owner_user_id is not null;

create trigger installment_plans_updated_at before update on public.installment_plans
  for each row execute function private.set_updated_at();
create trigger workspace_immutable before update on public.installment_plans
  for each row execute function private.prevent_workspace_change();
create trigger installment_plans_audit after insert or update or delete on public.installment_plans
  for each row execute function private.audit_row_change();

alter table public.installment_plans enable row level security;
-- Só leitura para os clientes; criar, alterar e cancelar passa pelas funções abaixo.
create policy "installment plans read" on public.installment_plans for select to authenticated
  using (private.can_access_finance(organization_id, owner_user_id, false));
revoke all on public.installment_plans from public, anon, authenticated;
grant select on public.installment_plans to authenticated;

alter table public.transactions
  add column installment_plan_id uuid references public.installment_plans (id),
  add column installment_number smallint check (installment_number between 1 and 360),
  add constraint transactions_installment_pair check ((installment_plan_id is null) = (installment_number is null));
create unique index transactions_installment_once_idx on public.transactions (installment_plan_id, installment_number)
  where installment_plan_id is not null;

-- A ligação a um plano só pode ser feita pelas funções de parcelas, e não muda depois.
create or replace function private.guard_installment_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.installment_plan_id is not null
       and coalesce(current_setting('anen.installments', true), '') <> new.installment_plan_id::text then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif new.installment_plan_id is distinct from old.installment_plan_id
     or new.installment_number is distinct from old.installment_number then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger transactions_installment_link before insert or update on public.transactions
  for each row execute function private.guard_installment_link();

-- Vencimento no mês de p_month com o dia pedido, limitado ao último dia do mês (espelho de dueDateIn).
create or replace function private.installment_due(p_month date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', p_month)::date
         + (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer) - 1);
$$;

-- ---------------------------------------------------------------------------
-- Criar um plano (e as parcelas)
-- ---------------------------------------------------------------------------
create or replace function public.create_installment_plan(
  p_org uuid,
  p_kind text,
  p_description text,
  p_account_id uuid,
  p_due_day integer,
  p_start_on date,
  p_total_minor bigint default null,
  p_per_minor bigint default null,
  p_count integer default null,
  p_end_on date default null,
  p_category_id uuid default null,
  p_contact_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_owner uuid := case when p_org is null then v_uid end;
  v_account public.financial_accounts%rowtype;
  v_month date;
  v_due date;
  v_dates date[] := '{}';
  v_n integer;
  v_base bigint;
  v_amount bigint;
  v_total bigint;
  v_plan uuid;
  i integer;
begin
  if not private.can_access_finance(p_org, v_owner, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('income', 'expense') or p_start_on is null
     or (p_total_minor is null) = (p_per_minor is null)
     or (p_count is null) = (p_end_on is null) then
    raise exception 'installment_invalid' using errcode = '22023';
  end if;
  if p_due_day is null or p_due_day not between 1 and 31 then
    raise exception 'installment_day_invalid' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 1 and 200 then
    raise exception 'description_required' using errcode = '22023';
  end if;

  select * into v_account from public.financial_accounts a
  where a.id = p_account_id
    and a.organization_id is not distinct from p_org
    and a.owner_user_id is not distinct from v_owner
    and a.archived_at is null;
  if not found then
    raise exception 'account_invalid' using errcode = '22023';
  end if;

  -- Primeiro mês: o do início, ou o seguinte se o vencimento desse mês já passou.
  v_month := date_trunc('month', p_start_on)::date;
  if private.installment_due(v_month, p_due_day) < p_start_on then
    v_month := (v_month + interval '1 month')::date;
  end if;

  if p_count is not null then
    if p_count not between 1 and 360 then
      raise exception 'installment_count_invalid' using errcode = '22023';
    end if;
    for i in 0 .. p_count - 1 loop
      v_dates := v_dates || private.installment_due((v_month + make_interval(months => i))::date, p_due_day);
    end loop;
  else
    i := 0;
    loop
      v_due := private.installment_due((v_month + make_interval(months => i))::date, p_due_day);
      exit when v_due > p_end_on;
      v_dates := v_dates || v_due;
      i := i + 1;
      if i > 360 then
        raise exception 'installment_count_invalid' using errcode = '22023';
      end if;
    end loop;
    if cardinality(v_dates) = 0 then
      raise exception 'installment_count_invalid' using errcode = '22023';
    end if;
  end if;

  v_n := cardinality(v_dates);
  if p_total_minor is not null then
    v_base := p_total_minor / v_n; -- divisão inteira; o resto vai para a última parcela
    if p_total_minor <= 0 or v_base < 1 then
      raise exception 'installment_amount_invalid' using errcode = '22023';
    end if;
    v_total := p_total_minor;
  else
    if p_per_minor <= 0 then
      raise exception 'installment_amount_invalid' using errcode = '22023';
    end if;
    v_base := p_per_minor;
    v_total := p_per_minor * v_n;
  end if;
  if v_total > 9007199254740991 then
    raise exception 'amount_invalid' using errcode = '22023';
  end if;

  insert into public.installment_plans (organization_id, owner_user_id, kind, description, account_id, category_id, contact_id,
                                        currency_code, total_minor, installment_count, due_day, start_on, first_due_on, last_due_on, created_by)
  values (p_org, v_owner, p_kind, btrim(p_description), p_account_id, p_category_id, p_contact_id,
          v_account.currency_code, v_total, v_n, p_due_day, p_start_on, v_dates[1], v_dates[v_n], v_uid)
  returning id into v_plan;

  perform set_config('anen.installments', v_plan::text, true);
  for i in 1 .. v_n loop
    v_amount := case when p_total_minor is not null and i = v_n then p_total_minor - v_base * (v_n - 1) else v_base end;
    insert into public.transactions (organization_id, owner_user_id, account_id, category_id, contact_id, kind, amount_minor,
                                     currency_code, occurred_on, due_on, description, settled_minor,
                                     installment_plan_id, installment_number)
    values (p_org, v_owner, p_account_id, p_category_id, p_contact_id, p_kind, v_amount,
            v_account.currency_code, v_dates[i], v_dates[i], btrim(p_description), 0,
            v_plan, i);
  end loop;
  perform set_config('anen.installments', '', true);
  return v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar as parcelas restantes (liquidação antecipada): as pagas e as parciais ficam
-- ---------------------------------------------------------------------------
create or replace function public.cancel_installments(p_plan_id uuid, p_from integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.installment_plans%rowtype;
  v_from integer;
  v_deleted integer;
begin
  perform private.require_user();
  select * into v_plan from public.installment_plans where id = p_plan_id for update;
  if not found or not private.can_access_finance(v_plan.organization_id, v_plan.owner_user_id, true) then
    raise exception 'installment_invalid' using errcode = '22023';
  end if;
  v_from := coalesce(p_from, (
    select min(t.installment_number) from public.transactions t where t.installment_plan_id = p_plan_id and t.settled_minor = 0
  ));
  if v_from is null then
    return 0; -- nada por liquidar
  end if;
  if v_from < 1 or v_from > v_plan.installment_count then
    raise exception 'installment_invalid' using errcode = '22023';
  end if;
  delete from public.transactions t
  where t.installment_plan_id = p_plan_id and t.installment_number >= v_from and t.settled_minor = 0;
  get diagnostics v_deleted = row_count;
  update public.installment_plans
  set cancelled_at = coalesce(cancelled_at, now()),
      cancelled_from = least(coalesce(cancelled_from, v_from), v_from)
  where id = p_plan_id;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alterar esta parcela e as seguintes (só as que ainda não têm nada liquidado)
-- ---------------------------------------------------------------------------
create or replace function public.update_installments_from(
  p_plan_id uuid,
  p_from integer,
  p_amount_minor bigint default null,
  p_due_day integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.installment_plans%rowtype;
  v_updated integer;
begin
  perform private.require_user();
  select * into v_plan from public.installment_plans where id = p_plan_id for update;
  if not found or not private.can_access_finance(v_plan.organization_id, v_plan.owner_user_id, true) then
    raise exception 'installment_invalid' using errcode = '22023';
  end if;
  if p_from is null or p_from < 1 or p_from > v_plan.installment_count or (p_amount_minor is null and p_due_day is null) then
    raise exception 'installment_invalid' using errcode = '22023';
  end if;
  if p_amount_minor is not null and (p_amount_minor <= 0 or p_amount_minor > 9007199254740991) then
    raise exception 'installment_amount_invalid' using errcode = '22023';
  end if;
  if p_due_day is not null and p_due_day not between 1 and 31 then
    raise exception 'installment_day_invalid' using errcode = '22023';
  end if;

  update public.transactions t
  set amount_minor = coalesce(p_amount_minor, t.amount_minor),
      due_on = case when p_due_day is null then t.due_on else private.installment_due(t.due_on, p_due_day) end,
      occurred_on = case when p_due_day is null then t.occurred_on else private.installment_due(t.occurred_on, p_due_day) end
  where t.installment_plan_id = p_plan_id and t.installment_number >= p_from and t.settled_minor = 0;
  get diagnostics v_updated = row_count;

  update public.installment_plans p
  set total_minor = (select coalesce(sum(t.amount_minor), 0) from public.transactions t where t.installment_plan_id = p_plan_id),
      due_day = coalesce(p_due_day, p.due_day),
      last_due_on = coalesce((select max(t.due_on) from public.transactions t where t.installment_plan_id = p_plan_id), p.last_due_on)
  where p.id = p_plan_id;
  return v_updated;
end;
$$;

revoke all on function public.create_installment_plan(uuid, text, text, uuid, integer, date, bigint, bigint, integer, date, uuid, uuid) from public, anon;
revoke all on function public.cancel_installments(uuid, integer) from public, anon;
revoke all on function public.update_installments_from(uuid, integer, bigint, integer) from public, anon;
grant execute on function public.create_installment_plan(uuid, text, text, uuid, integer, date, bigint, bigint, integer, date, uuid, uuid) to authenticated;
grant execute on function public.cancel_installments(uuid, integer) to authenticated;
grant execute on function public.update_installments_from(uuid, integer, bigint, integer) to authenticated;
revoke all on function private.installment_due(date, integer) from public, anon;
grant execute on function private.installment_due(date, integer) to authenticated;
