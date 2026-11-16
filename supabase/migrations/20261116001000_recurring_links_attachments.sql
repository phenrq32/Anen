-- ANEN · Prompt 03 · Fase 2 · Recorrentes completos e anexos
-- 1. Recorrentes com cliente/fornecedor, projeto, centro de custo, tipo de custo, geração como
--    pendente e vencimento N dias após a ocorrência. Os movimentos gerados herdam tudo isto.
-- 2. Anexos (faturas, recibos) em Supabase Storage privado, com RLS pelo âmbito do movimento.

-- ---------------------------------------------------------------------------
-- 1. Recorrentes
-- ---------------------------------------------------------------------------
alter table public.recurring_transactions
  add column contact_id uuid references public.contacts (id) on delete set null,
  add column project_id uuid references public.projects (id) on delete set null,
  add column cost_center_id uuid references public.cost_centers (id) on delete set null,
  add column cost_kind text check (cost_kind in ('material', 'labor', 'travel', 'equipment', 'overhead', 'other')),
  add column generate_pending boolean not null default false,
  add column due_days smallint check (due_days between 0 and 365);

create or replace function private.validate_recurring_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id
      and c.organization_id is not distinct from new.organization_id and c.owner_user_id is not distinct from new.owner_user_id
  ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  if new.cost_center_id is not null and not exists (
    select 1 from public.cost_centers c where c.id = new.cost_center_id
      and c.organization_id is not distinct from new.organization_id and c.owner_user_id is not distinct from new.owner_user_id
  ) then
    raise exception 'cost_center_invalid' using errcode = '22023';
  end if;
  if new.project_id is not null then
    if not exists (
      select 1 from public.projects p where p.id = new.project_id
        and p.organization_id is not distinct from new.organization_id and p.owner_user_id is not distinct from new.owner_user_id
    ) then
      raise exception 'project_invalid' using errcode = '22023';
    end if;
    select a.currency_code into v_currency from public.financial_accounts a where a.id = new.account_id;
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.currency_code = v_currency) then
      raise exception 'project_currency_mismatch' using errcode = '22023';
    end if;
  end if;
  if new.kind = 'income' then
    new.cost_kind := null;
  end if;
  return new;
end;
$$;
create trigger recurring_links before insert or update on public.recurring_transactions
  for each row execute function private.validate_recurring_links();

-- Edição: só os campos que não mudam o calendário já gerado (frequência e início ficam fixos).
revoke update on public.recurring_transactions from authenticated;
grant update (category_id, amount_minor, description, counterparty, end_on, is_active,
  contact_id, project_id, cost_center_id, cost_kind, generate_pending, due_days)
  on public.recurring_transactions to authenticated;

-- Geração (por âmbito, pelo utilizador): passa a copiar ligações, estado e vencimento.
-- SECURITY DEFINER: o calendário (next_run_on, occurrence_count) deixou de ser editável pelos
-- clientes, por isso a função avança-o ela própria, depois de verificar a permissão de escrita.
create or replace function public.materialize_recurring(p_org uuid, p_until date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_transactions%rowtype;
  v_created integer := 0;
  v_guard integer := 0;
  v_step interval;
begin
  if (select auth.uid()) is null
     or (p_org is not null and not private.can_access_finance(p_org, null, true)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Não gera para além de amanhã (margem de fuso horário): não se antecipam movimentos futuros.
  if p_until > current_date + 1 then
    p_until := current_date + 1;
  end if;
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
                                       occurred_on, description, counterparty, recurring_id,
                                       contact_id, project_id, cost_center_id, cost_kind, settled_minor, due_on)
      values (r.organization_id, r.owner_user_id, r.account_id, r.category_id, r.kind, r.amount_minor, r.currency_code,
              r.next_run_on, r.description, r.counterparty, r.id,
              r.contact_id, r.project_id, r.cost_center_id, r.cost_kind,
              case when r.generate_pending then 0 else r.amount_minor end,
              case when r.due_days is null then null else r.next_run_on + r.due_days end)
      on conflict do nothing;
      if found then v_created := v_created + 1; end if;
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

-- Geração diária no servidor (todos os âmbitos), com as mesmas regras.
create or replace function private.materialize_all_recurring(p_until date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_transactions%rowtype;
  v_created integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_guard integer;
  v_step interval;
begin
  for r in
    select * from public.recurring_transactions rt
    where rt.is_active and rt.next_run_on <= p_until
    order by rt.next_run_on
    for update skip locked
  loop
    begin
      v_guard := 0;
      v_step := case r.frequency
        when 'weekly' then make_interval(weeks => r.interval_count)
        when 'monthly' then make_interval(months => r.interval_count)
        else make_interval(years => r.interval_count) end;
      while r.next_run_on <= p_until and (r.end_on is null or r.next_run_on <= r.end_on) and v_guard < 1000 loop
        insert into public.transactions (organization_id, owner_user_id, account_id, category_id, kind, amount_minor, currency_code,
                                         occurred_on, description, counterparty, recurring_id, created_by,
                                         contact_id, project_id, cost_center_id, cost_kind, settled_minor, due_on)
        values (r.organization_id, r.owner_user_id, r.account_id, r.category_id, r.kind, r.amount_minor, r.currency_code,
                r.next_run_on, r.description, r.counterparty, r.id, r.created_by,
                r.contact_id, r.project_id, r.cost_center_id, r.cost_kind,
                case when r.generate_pending then 0 else r.amount_minor end,
                case when r.due_days is null then null else r.next_run_on + r.due_days end)
        on conflict do nothing;
        if found then v_created := v_created + 1; end if;
        r.occurrence_count := r.occurrence_count + 1;
        r.next_run_on := (r.start_on + v_step * r.occurrence_count)::date;
        v_guard := v_guard + 1;
      end loop;
      update public.recurring_transactions
      set next_run_on = r.next_run_on,
          occurrence_count = r.occurrence_count,
          is_active = (r.end_on is null or r.next_run_on <= r.end_on)
      where id = r.id;
    exception when others then
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('recurring_id', r.id, 'error', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'failed', v_failed, 'errors', v_errors);
end;
$$;
revoke all on function private.materialize_all_recurring(date) from public;

-- ---------------------------------------------------------------------------
-- 2. Anexos de movimentos
-- Caminho no Storage: {âmbito}/{movimento}/{ficheiro}, em que âmbito = organização ou pessoa.
-- ---------------------------------------------------------------------------
create table public.transaction_attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint transaction_attachments_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index transaction_attachments_tx_idx on public.transaction_attachments (transaction_id);

-- O âmbito vem SEMPRE do movimento; o caminho tem de começar por {âmbito}/{movimento}/.
create or replace function private.set_attachment_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Única alteração permitida: o autor passa a NULL quando a conta dele é apagada (RGPD/LGPD).
    if new.created_by is null and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
      return new;
    end if;
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_tx from public.transactions t where t.id = new.transaction_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  new.organization_id := v_tx.organization_id;
  new.owner_user_id := v_tx.owner_user_id;
  new.created_by := auth.uid();
  if new.storage_path not like coalesce(v_tx.organization_id, v_tx.owner_user_id)::text || '/' || v_tx.id::text || '/%' then
    raise exception 'attachment_path_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger transaction_attachments_scope before insert or update on public.transaction_attachments
  for each row execute function private.set_attachment_scope();

alter table public.transaction_attachments enable row level security;
create policy "finance read" on public.transaction_attachments for select to authenticated
  using (private.can_access_finance(organization_id, owner_user_id, false));
create policy "finance insert" on public.transaction_attachments for insert to authenticated
  with check (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and private.can_access_finance(t.organization_id, t.owner_user_id, true)
  ));
create policy "finance delete" on public.transaction_attachments for delete to authenticated
  using (private.can_access_finance(organization_id, owner_user_id, true));
revoke all on public.transaction_attachments from anon;
revoke update, truncate on public.transaction_attachments from authenticated;

-- Pode escrever no caminho {âmbito}/{movimento}/…? (usado pelas políticas do Storage)
create or replace function private.can_write_attachment_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_tx public.transactions%rowtype;
begin
  if array_length(v_parts, 1) <> 3 or v_parts[2] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  select * into v_tx from public.transactions t where t.id = v_parts[2]::uuid;
  if not found or coalesce(v_tx.organization_id, v_tx.owner_user_id)::text <> v_parts[1] then
    return false;
  end if;
  return private.can_access_finance(v_tx.organization_id, v_tx.owner_user_id, true);
end;
$$;
revoke all on function private.can_write_attachment_path(text) from public;
grant execute on function private.can_write_attachment_path(text) to authenticated;

-- Bucket privado e políticas (só onde o Storage existe: produção Supabase).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute $p$create policy "attachments read" on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and exists (select 1 from public.transaction_attachments a where a.storage_path = name))$p$;
    execute $p$create policy "attachments insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and private.can_write_attachment_path(name))$p$;
    execute $p$create policy "attachments delete" on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and private.can_write_attachment_path(name))$p$;
  end if;
end;
$$;
