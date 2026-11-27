-- Dual Workspace · Fase 7 (§7): transferências entre ambientes (ex.: o proprietário retira 500 € da empresa para a
-- conta pessoal). Uma operação cria os dois movimentos (saída na origem, entrada no destino) na mesma transação da
-- base de dados: ou ficam os dois, ou nenhum. Referência comum, idempotência (client_ref), reversão por movimentos
-- de compensação (nada é apagado) e confirmação de permissões nos dois espaços. A classificação de cada lado
-- (categoria) é escolhida pela pessoa; a ANEN não decide se é rendimento, lucro, despesa ou distribuição.
-- Aprovado pelo dono da app a 27/11/2026. Não altera nem apaga dados existentes.
-- Reversão: drop function public.revert_cross_workspace_transfer(uuid, text); drop function public.create_cross_workspace_transfer(jsonb);
--           drop trigger transactions_transfer_guard on public.transactions; drop function private.guard_transfer_transactions();
--           drop table public.cross_workspace_transfers;

create table public.cross_workspace_transfers (
  id uuid primary key default gen_random_uuid(),
  -- Referência comum, mostrada nos dois movimentos (TRF-AAAAMMDD-XXXXXX).
  reference text not null unique check (reference ~ '^TRF-[0-9]{8}-[0-9A-F]{6}$'),
  source_workspace_type text not null check (source_workspace_type in ('PERSONAL', 'BUSINESS')),
  source_workspace_id uuid not null,
  destination_workspace_type text not null check (destination_workspace_type in ('PERSONAL', 'BUSINESS')),
  destination_workspace_id uuid not null,
  source_transaction_id uuid not null references public.transactions (id) on delete cascade,
  destination_transaction_id uuid not null references public.transactions (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency_code char(3) not null references public.currencies (code),
  transfer_date date not null,
  -- Natureza indicada pela pessoa (não é uma classificação fiscal).
  transfer_type text not null check (transfer_type in ('owner_withdrawal', 'owner_contribution', 'reimbursement', 'loan', 'other')),
  status text not null default 'completed' check (status in ('completed', 'reverted')),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  -- Idempotência: o mesmo pedido (mesma pessoa, mesmo client_ref) não cria uma segunda transferência.
  client_ref uuid not null,
  reversal_source_transaction_id uuid references public.transactions (id) on delete cascade,
  reversal_destination_transaction_id uuid references public.transactions (id) on delete cascade,
  reverted_at timestamptz,
  reverted_by uuid references auth.users (id) on delete set null,
  revert_reason text check (revert_reason is null or char_length(btrim(revert_reason)) between 1 and 200),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint cross_workspace_transfers_distinct check (
    (source_workspace_type, source_workspace_id) is distinct from (destination_workspace_type, destination_workspace_id)
  ),
  constraint cross_workspace_transfers_reverted check (
    (status = 'completed' and reverted_at is null and reversal_source_transaction_id is null and reversal_destination_transaction_id is null)
    or (status = 'reverted' and reverted_at is not null and reversal_source_transaction_id is not null and reversal_destination_transaction_id is not null)
  ),
  unique (created_by, client_ref)
);
create index cross_workspace_transfers_source_idx on public.cross_workspace_transfers (source_workspace_type, source_workspace_id, transfer_date desc);
create index cross_workspace_transfers_destination_idx on public.cross_workspace_transfers (destination_workspace_type, destination_workspace_id, transfer_date desc);

/** Leitura de um lado da transferência: mesmo direito que ler as finanças desse espaço. */
create or replace function private.can_read_transfer_side(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'PERSONAL' then private.can_access_finance(null, p_id, false)
    when 'BUSINESS' then private.can_access_finance(p_id, null, false)
    else false
  end;
$$;
revoke all on function private.can_read_transfer_side(text, uuid) from public, anon;
grant execute on function private.can_read_transfer_side(text, uuid) to authenticated;

alter table public.cross_workspace_transfers enable row level security;
-- Vê a transferência quem pode ver as finanças de um dos lados. Escritas só pelas funções abaixo.
create policy "read" on public.cross_workspace_transfers for select to authenticated
  using (private.can_read_transfer_side(source_workspace_type, source_workspace_id)
         or private.can_read_transfer_side(destination_workspace_type, destination_workspace_id));
revoke all on public.cross_workspace_transfers from public, anon, authenticated;
grant select on public.cross_workspace_transfers to authenticated;

-- Os movimentos de uma transferência não se apagam nem mudam de valor, conta, tipo, moeda ou data à parte
-- (deixariam os dois lados incoerentes). A classificação (categoria), a descrição e as notas de cada lado mudam-se.
create or replace function private.guard_transfer_transactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.cross_workspace_transfers x
    where old.id in (x.source_transaction_id, x.destination_transaction_id, x.reversal_source_transaction_id, x.reversal_destination_transaction_id)
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    -- A eliminação da organização, da conta financeira ou da conta da pessoa (cascata) continua possível; a
    -- transferência desaparece com ela e o movimento do outro lado fica, com a referência nas notas.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'transfer_locked' using errcode = '42501';
  end if;
  if new.amount_minor <> old.amount_minor or new.kind <> old.kind or new.account_id <> old.account_id
     or new.currency_code <> old.currency_code or new.occurred_on <> old.occurred_on or new.settled_minor <> old.settled_minor then
    raise exception 'transfer_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger transactions_transfer_guard before update or delete on public.transactions
  for each row execute function private.guard_transfer_transactions();

/**
 * Cria a transferência e os dois movimentos, numa só transação.
 * p: { client_ref, source_type, source_id, source_account_id, source_category_id?, destination_type, destination_id,
 *      destination_account_id, destination_category_id?, amount_minor, transfer_date, transfer_type, description }
 * Devolve o id da transferência (o já existente, se o client_ref se repetir).
 */
create or replace function public.create_cross_workspace_transfer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ref uuid := nullif(p ->> 'client_ref', '')::uuid;
  v_existing uuid;
  v_src_type text := p ->> 'source_type';
  v_src_id uuid := nullif(p ->> 'source_id', '')::uuid;
  v_dst_type text := p ->> 'destination_type';
  v_dst_id uuid := nullif(p ->> 'destination_id', '')::uuid;
  v_src_account public.financial_accounts%rowtype;
  v_dst_account public.financial_accounts%rowtype;
  v_src_cat uuid := nullif(p ->> 'source_category_id', '')::uuid;
  v_dst_cat uuid := nullif(p ->> 'destination_category_id', '')::uuid;
  v_amount bigint := (p ->> 'amount_minor')::bigint;
  v_date date := (p ->> 'transfer_date')::date;
  v_type text := p ->> 'transfer_type';
  v_desc text := btrim(coalesce(p ->> 'description', ''));
  v_reference text;
  v_src_tx uuid;
  v_dst_tx uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_ref is null or v_src_id is null or v_dst_id is null or v_amount is null or v_date is null then
    raise exception 'transfer_invalid' using errcode = '22023';
  end if;
  -- Idempotência: repetir o mesmo pedido devolve a transferência já criada.
  select id into v_existing from public.cross_workspace_transfers where created_by = v_uid and client_ref = v_ref;
  if found then
    return v_existing;
  end if;
  if v_src_type not in ('PERSONAL', 'BUSINESS') or v_dst_type not in ('PERSONAL', 'BUSINESS')
     or (v_src_type = v_dst_type and v_src_id = v_dst_id) then
    raise exception 'transfer_invalid' using errcode = '22023';
  end if;
  if v_amount <= 0 or v_type not in ('owner_withdrawal', 'owner_contribution', 'reimbursement', 'loan', 'other')
     or char_length(v_desc) not between 1 and 200 then
    raise exception 'transfer_invalid' using errcode = '22023';
  end if;
  -- Autorização nos dois espaços (escrever finanças).
  if not private.can_access_finance(case when v_src_type = 'BUSINESS' then v_src_id end, case when v_src_type = 'PERSONAL' then v_src_id end, true)
     or not private.can_access_finance(case when v_dst_type = 'BUSINESS' then v_dst_id end, case when v_dst_type = 'PERSONAL' then v_dst_id end, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- As contas têm de pertencer a cada espaço, estar ativas e ter a mesma moeda.
  select * into v_src_account from public.financial_accounts a where a.id = nullif(p ->> 'source_account_id', '')::uuid;
  select * into v_dst_account from public.financial_accounts a where a.id = nullif(p ->> 'destination_account_id', '')::uuid;
  if v_src_account.id is null or v_dst_account.id is null
     or v_src_account.archived_at is not null or v_dst_account.archived_at is not null
     or (v_src_type = 'BUSINESS' and v_src_account.organization_id is distinct from v_src_id)
     or (v_src_type = 'PERSONAL' and v_src_account.owner_user_id is distinct from v_src_id)
     or (v_dst_type = 'BUSINESS' and v_dst_account.organization_id is distinct from v_dst_id)
     or (v_dst_type = 'PERSONAL' and v_dst_account.owner_user_id is distinct from v_dst_id) then
    raise exception 'transfer_invalid' using errcode = '22023';
  end if;
  if v_src_account.currency_code <> v_dst_account.currency_code then
    raise exception 'transfer_currency_mismatch' using errcode = '22023';
  end if;
  -- Categorias opcionais: de cada lado, do tipo certo (saída = despesa, entrada = receita) e do mesmo espaço ou de sistema.
  if v_src_cat is not null and not exists (
    select 1 from public.transaction_categories c where c.id = v_src_cat and c.kind = 'expense' and c.archived_at is null
      and (c.is_system or (v_src_type = 'BUSINESS' and c.organization_id = v_src_id) or (v_src_type = 'PERSONAL' and c.owner_user_id = v_src_id))
  ) then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if v_dst_cat is not null and not exists (
    select 1 from public.transaction_categories c where c.id = v_dst_cat and c.kind = 'income' and c.archived_at is null
      and (c.is_system or (v_dst_type = 'BUSINESS' and c.organization_id = v_dst_id) or (v_dst_type = 'PERSONAL' and c.owner_user_id = v_dst_id))
  ) then
    raise exception 'category_invalid' using errcode = '22023';
  end if;

  v_reference := 'TRF-' || to_char(v_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.transactions (organization_id, owner_user_id, account_id, category_id, kind, amount_minor, currency_code, occurred_on,
                                   description, notes, created_by)
  values (case when v_src_type = 'BUSINESS' then v_src_id end, case when v_src_type = 'PERSONAL' then v_src_id end, v_src_account.id, v_src_cat,
          'expense', v_amount, v_src_account.currency_code, v_date, left(v_desc, 200), v_reference, v_uid)
  returning id into v_src_tx;
  insert into public.transactions (organization_id, owner_user_id, account_id, category_id, kind, amount_minor, currency_code, occurred_on,
                                   description, notes, created_by)
  values (case when v_dst_type = 'BUSINESS' then v_dst_id end, case when v_dst_type = 'PERSONAL' then v_dst_id end, v_dst_account.id, v_dst_cat,
          'income', v_amount, v_dst_account.currency_code, v_date, left(v_desc, 200), v_reference, v_uid)
  returning id into v_dst_tx;
  insert into public.cross_workspace_transfers (reference, source_workspace_type, source_workspace_id, destination_workspace_type, destination_workspace_id,
                                                source_transaction_id, destination_transaction_id, amount_minor, currency_code, transfer_date,
                                                transfer_type, description, client_ref, created_by)
  values (v_reference, v_src_type, v_src_id, v_dst_type, v_dst_id, v_src_tx, v_dst_tx, v_amount, v_src_account.currency_code, v_date,
          v_type, v_desc, v_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_cross_workspace_transfer(jsonb) from public, anon;
grant execute on function public.create_cross_workspace_transfer(jsonb) to authenticated;

/**
 * Reverte uma transferência: cria os movimentos de compensação (entrada na origem, saída no destino) com a mesma
 * referência e marca-a como revertida. Exige permissão de escrita nos dois espaços. Repetir é inofensivo.
 */
create or replace function public.revert_cross_workspace_transfer(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_x public.cross_workspace_transfers%rowtype;
  v_src public.transactions%rowtype;
  v_dst public.transactions%rowtype;
  v_today date;
  v_rs uuid;
  v_rd uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_x from public.cross_workspace_transfers where id = p_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.can_access_finance(case when v_x.source_workspace_type = 'BUSINESS' then v_x.source_workspace_id end,
                                    case when v_x.source_workspace_type = 'PERSONAL' then v_x.source_workspace_id end, true)
     or not private.can_access_finance(case when v_x.destination_workspace_type = 'BUSINESS' then v_x.destination_workspace_id end,
                                       case when v_x.destination_workspace_type = 'PERSONAL' then v_x.destination_workspace_id end, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_x.status = 'reverted' then
    return;
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'transfer_invalid' using errcode = '22023';
  end if;
  select * into v_src from public.transactions where id = v_x.source_transaction_id;
  select * into v_dst from public.transactions where id = v_x.destination_transaction_id;
  v_today := greatest(v_x.transfer_date, current_date);
  insert into public.transactions (organization_id, owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on, description, notes, created_by)
  values (v_src.organization_id, v_src.owner_user_id, v_src.account_id, 'income', v_x.amount_minor, v_x.currency_code, v_today,
          left('Reversão: ' || v_x.description, 200), v_x.reference, v_uid)
  returning id into v_rs;
  insert into public.transactions (organization_id, owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on, description, notes, created_by)
  values (v_dst.organization_id, v_dst.owner_user_id, v_dst.account_id, 'expense', v_x.amount_minor, v_x.currency_code, v_today,
          left('Reversão: ' || v_x.description, 200), v_x.reference, v_uid)
  returning id into v_rd;
  update public.cross_workspace_transfers
     set status = 'reverted', reverted_at = now(), reverted_by = v_uid, revert_reason = v_reason,
         reversal_source_transaction_id = v_rs, reversal_destination_transaction_id = v_rd
   where id = p_id;
end;
$$;
revoke all on function public.revert_cross_workspace_transfer(uuid, text) from public, anon;
grant execute on function public.revert_cross_workspace_transfer(uuid, text) to authenticated;
