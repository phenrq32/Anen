-- ANEN · Correção: permitir apagar contas de utilizador (RGPD/LGPD, direito ao apagamento).
-- Ao apagar auth.users, as FKs "on delete set null" põem created_by = NULL; os triggers que
-- protegiam o autor bloqueavam essa alteração e a eliminação da conta falhava.
-- Regra nova: o autor nunca pode ser trocado por outro utilizador, mas pode passar a NULL.

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
    if new.created_by is not null then
      new.created_by := old.created_by;
    end if;
    if new.organization_id is distinct from old.organization_id or new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if new.currency_code <> old.currency_code and exists (select 1 from public.transactions t where t.account_id = old.id) then
      raise exception 'account_currency_locked' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

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
    if new.created_by is not null then
      new.created_by := old.created_by;
    end if;
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
        or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'forbidden' using errcode = '42501';
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
     or new.number <> old.number
     or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Eliminação do autor (created_by -> NULL) não é uma edição de conteúdo nem de estado.
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
