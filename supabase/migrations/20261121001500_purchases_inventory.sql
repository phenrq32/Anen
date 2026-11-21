-- ANEN · Prompt 03 · Fase 8: compras, inventário e reposição.
--
-- 1. Inventário: artigos em stock (stock_items) e movimentos imutáveis (stock_movements: entrada, saída,
--    perda e contagem). O saldo e o custo médio ponderado são calculados no servidor, por um trigger que
--    bloqueia a linha do artigo: o cliente nunca escreve o saldo nem o custo. Os movimentos não se editam
--    nem se apagam; uma correção é uma contagem (ou um movimento novo), e tudo fica no histórico.
--    Os movimentos aplicam-se pela ordem de registo; a data serve de informação (não há recálculo retroativo).
-- 2. Encomendas a fornecedores (purchase_orders + purchase_order_items). O total é mantido pelo servidor.
--    Receber a encomenda (receive_purchase_order) faz tudo numa transação: entradas de stock com o custo da
--    linha, preços no histórico do fornecedor (supplier_prices) e, se for indicada uma conta, a despesa.
-- 3. Reposição: stock_reorder_suggestions lista o que está abaixo do mínimo (descontando o que já está
--    encomendado) e create_reorder_drafts cria rascunhos de encomenda por fornecedor.

-- ---------------------------------------------------------------------------
-- 1. Inventário
-- ---------------------------------------------------------------------------
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  sku text check (char_length(sku) <= 60),
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  currency_code char(3) not null references public.currencies (code),
  min_quantity numeric(14, 3) not null default 0 check (min_quantity >= 0),
  target_quantity numeric(14, 3) check (target_quantity >= 0),
  preferred_supplier_id uuid references public.contacts (id) on delete set null,
  quantity_on_hand numeric(14, 3) not null default 0 check (quantity_on_hand >= 0),
  average_cost_minor bigint not null default 0 check (average_cost_minor between 0 and 9007199254740991),
  notes text check (char_length(notes) <= 1000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_items_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index stock_items_org_name_idx on public.stock_items (organization_id, lower(name)) where organization_id is not null;
create unique index stock_items_owner_name_idx on public.stock_items (owner_user_id, lower(name)) where owner_user_id is not null;
create index stock_items_supplier_idx on public.stock_items (preferred_supplier_id) where preferred_supplier_id is not null;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  -- Apagar o fornecedor não apaga o histórico de compras.
  supplier_id uuid references public.contacts (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  currency_code char(3) not null references public.currencies (code),
  project_id uuid references public.projects (id) on delete set null,
  ordered_on date,
  expected_on date,
  received_on date,
  notes text check (char_length(notes) <= 2000),
  total_minor bigint not null default 0 check (total_minor between 0 and 9007199254740991),
  transaction_id uuid references public.transactions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index purchase_orders_org_idx on public.purchase_orders (organization_id, created_at desc) where organization_id is not null;
create index purchase_orders_owner_idx on public.purchase_orders (owner_user_id, created_at desc) where owner_user_id is not null;
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id) where supplier_id is not null;

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id) on delete cascade,
  position smallint not null default 0 check (position between 0 and 500),
  stock_item_id uuid references public.stock_items (id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 160),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text check (char_length(unit) <= 20),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 9007199254740991),
  total_minor bigint not null default 0 check (total_minor between 0 and 9007199254740991)
);
create index purchase_order_items_order_idx on public.purchase_order_items (order_id, position);
create index purchase_order_items_stock_idx on public.purchase_order_items (stock_item_id) where stock_item_id is not null;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  item_id uuid not null references public.stock_items (id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'loss', 'count')),
  -- Entrada, saída e perda: quantidade movimentada (> 0). Contagem: quantidade contada (>= 0).
  quantity numeric(14, 3) not null check (quantity >= 0),
  -- Entrada: custo unitário da compra. Saída, perda e contagem: custo médio no momento (calculado).
  unit_cost_minor bigint check (unit_cost_minor between 0 and 9007199254740991),
  occurred_on date not null default current_date,
  notes text check (char_length(notes) <= 500),
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  -- Calculados pelo servidor.
  quantity_change numeric(15, 3) not null default 0,
  balance_after numeric(14, 3) not null default 0,
  average_cost_after bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_movements_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index stock_movements_item_idx on public.stock_movements (item_id, created_at desc);
create index stock_movements_order_idx on public.stock_movements (purchase_order_id) where purchase_order_id is not null;

-- ---------------------------------------------------------------------------
-- Integridade
-- ---------------------------------------------------------------------------

-- Artigo: nome e unidade normalizados; saldo e custo só mudam pelos movimentos; fornecedor preferido
-- do mesmo âmbito e com o papel de fornecedor; unidade e moeda fixas (não há permissão de update).
create or replace function private.validate_stock_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.unit := btrim(new.unit);
  new.sku := nullif(btrim(coalesce(new.sku, '')), '');
  if tg_op = 'INSERT' then
    new.quantity_on_hand := 0;
    new.average_cost_minor := 0;
    if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
      raise exception 'unsupported_reference' using errcode = '22023';
    end if;
  end if;
  if new.preferred_supplier_id is not null
     and (tg_op = 'INSERT' or new.preferred_supplier_id is distinct from old.preferred_supplier_id)
     and not exists (
       select 1 from public.contacts c
       where c.id = new.preferred_supplier_id
         and c.organization_id is not distinct from new.organization_id
         and c.owner_user_id is not distinct from new.owner_user_id
         and c.kind in ('supplier', 'both')
     ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Movimento: aplica-se ao saldo do artigo com a linha bloqueada (sem corridas entre pedidos).
-- Custo médio ponderado: (saldo × custo médio + quantidade × custo da entrada) / (saldo + quantidade),
-- arredondado à unidade mínima. Saídas e perdas não mudam o custo médio e não podem deixar o saldo negativo.
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

-- Encomenda: fornecedor e projeto do mesmo âmbito (projeto na mesma moeda); estados permitidos;
-- conteúdo bloqueado depois de recebida ou cancelada. "Recebida" só pela função de receção.
create or replace function private.guard_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receiving boolean := coalesce(current_setting('anen.receiving_purchase', true), '') = new.id::text;
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.total_minor := 0;
    new.transaction_id := null;
    new.received_on := null;
    if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
      raise exception 'unsupported_reference' using errcode = '22023';
    end if;
  else
    -- Eliminação do autor (created_by -> NULL) e do fornecedor ou do projeto (on delete set null).
    -- Só passa quando nada mais muda (um utilizador não pode juntar outra alteração a esta).
    if ((new.created_by is null and old.created_by is not null)
        or (new.supplier_id is null and old.supplier_id is not null)
        or (new.project_id is null and old.project_id is not null)
        or (new.transaction_id is null and old.transaction_id is not null))
       and (new.status, new.currency_code, new.ordered_on, new.expected_on, new.received_on, new.notes, new.total_minor)
           is not distinct from (old.status, old.currency_code, old.ordered_on, old.expected_on, old.received_on, old.notes, old.total_minor)
       and (new.supplier_id is null or new.supplier_id = old.supplier_id)
       and (new.project_id is null or new.project_id = old.project_id)
       and (new.transaction_id is null or new.transaction_id = old.transaction_id) then
      return new;
    end if;
    if new.currency_code <> old.currency_code and exists (select 1 from public.purchase_order_items i where i.order_id = old.id) then
      raise exception 'purchase_currency_locked' using errcode = '22023';
    end if;
    if old.status in ('received', 'cancelled') and (
         new.supplier_id, new.currency_code, new.project_id, new.ordered_on, new.expected_on, new.notes
       ) is distinct from (
         old.supplier_id, old.currency_code, old.project_id, old.ordered_on, old.expected_on, old.notes
       ) then
      raise exception 'purchase_locked' using errcode = '22023';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'received' then
        if not v_receiving then
          raise exception 'purchase_status_invalid' using errcode = '22023';
        end if;
      elsif not (
        (old.status = 'draft' and new.status in ('ordered', 'cancelled'))
        or (old.status = 'ordered' and new.status in ('draft', 'cancelled'))
        or (old.status = 'cancelled' and new.status = 'draft')
      ) then
        raise exception 'purchase_status_invalid' using errcode = '22023';
      end if;
      if new.status = 'ordered' and new.ordered_on is null then
        new.ordered_on := current_date;
      end if;
    end if;
    if not v_receiving and (new.total_minor, new.transaction_id, new.received_on) is distinct from (old.total_minor, old.transaction_id, old.received_on)
       and coalesce(current_setting('anen.purchase_total', true), '') <> new.id::text then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if new.supplier_id is not null
     and (tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id)
     and not exists (
       select 1 from public.contacts c
       where c.id = new.supplier_id
         and c.organization_id is not distinct from new.organization_id
         and c.owner_user_id is not distinct from new.owner_user_id
         and c.kind in ('supplier', 'both')
     ) then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and new.supplier_id is null then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id or new.currency_code <> old.currency_code)
     and not exists (
       select 1 from public.projects p
       where p.id = new.project_id
         and p.organization_id is not distinct from new.organization_id
         and p.owner_user_id is not distinct from new.owner_user_id
         and p.currency_code = new.currency_code
     ) then
    raise exception 'project_invalid' using errcode = '22023';
  end if;
  if new.expected_on is not null and new.ordered_on is not null and new.expected_on < new.ordered_on then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Linha: só em encomendas por receber; artigo de stock do mesmo âmbito e moeda (a unidade passa a ser
-- a do artigo, porque a quantidade entra no stock tal como está); total = quantidade × preço, arredondado.
create or replace function private.guard_purchase_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_item public.stock_items%rowtype;
begin
  select * into v_order from public.purchase_orders
  where id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if tg_op = 'DELETE' then
    -- Apagar a encomenda inteira (cascata) é sempre permitido; apagar linhas soltas só antes de receber.
    if found and v_order.status not in ('draft', 'ordered') then
      raise exception 'purchase_locked' using errcode = '22023';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.order_id <> old.order_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- O artigo apagado (on delete set null) não é uma edição.
  if tg_op = 'UPDATE' and new.stock_item_id is null and old.stock_item_id is not null
     and (new.description, new.quantity, new.unit, new.unit_price_minor, new.position)
         is not distinct from (old.description, old.quantity, old.unit, old.unit_price_minor, old.position) then
    return new;
  end if;
  if v_order.status not in ('draft', 'ordered') then
    raise exception 'purchase_locked' using errcode = '22023';
  end if;
  new.description := regexp_replace(btrim(new.description), '\s+', ' ', 'g');
  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  if new.stock_item_id is not null then
    select * into v_item from public.stock_items where id = new.stock_item_id;
    if not found
       or v_item.organization_id is distinct from v_order.organization_id
       or v_item.owner_user_id is distinct from v_order.owner_user_id
       or v_item.currency_code <> v_order.currency_code then
      raise exception 'stock_item_invalid' using errcode = '22023';
    end if;
    new.unit := v_item.unit;
  end if;
  new.total_minor := round(new.quantity * new.unit_price_minor)::bigint;
  return new;
end;
$$;

create or replace function private.sync_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
begin
  if not exists (select 1 from public.purchase_orders o where o.id = v_order and o.status in ('draft', 'ordered')) then
    return null;
  end if;
  perform set_config('anen.purchase_total', v_order::text, true);
  update public.purchase_orders
  set total_minor = coalesce((select sum(i.total_minor) from public.purchase_order_items i where i.order_id = v_order), 0)
  where id = v_order;
  perform set_config('anen.purchase_total', '', true);
  return null;
end;
$$;

create trigger stock_items_scope before insert or update on public.stock_items for each row execute function private.set_creator_and_lock_scope();
create trigger stock_items_validate before insert or update on public.stock_items for each row execute function private.validate_stock_item();
create trigger stock_items_updated_at before update on public.stock_items for each row execute function private.set_updated_at();
create trigger stock_items_audit after insert or update or delete on public.stock_items for each row execute function private.audit_row_change();
create trigger stock_movements_apply before insert on public.stock_movements for each row execute function private.apply_stock_movement();
create trigger stock_movements_audit after insert on public.stock_movements for each row execute function private.audit_row_change();
create trigger purchase_orders_scope before insert or update on public.purchase_orders for each row execute function private.set_creator_and_lock_scope();
create trigger purchase_orders_guard before insert or update on public.purchase_orders for each row execute function private.guard_purchase_order();
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function private.set_updated_at();
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders for each row execute function private.audit_row_change();
create trigger purchase_order_items_guard before insert or update or delete on public.purchase_order_items for each row execute function private.guard_purchase_order_item();
create trigger purchase_order_items_total after insert or update or delete on public.purchase_order_items for each row execute function private.sync_purchase_order_total();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['stock_items', 'purchase_orders'] loop
    execute format('create policy "business read" on public.%I for select to authenticated using (private.can_access_business(organization_id, owner_user_id, false))', t);
    execute format('create policy "business insert" on public.%I for insert to authenticated with check (private.can_access_business(organization_id, owner_user_id, true))', t);
    execute format('create policy "business update" on public.%I for update to authenticated using (private.can_access_business(organization_id, owner_user_id, true)) with check (private.can_access_business(organization_id, owner_user_id, true))', t);
  end loop;
  foreach t in array array['stock_items', 'purchase_orders', 'purchase_order_items', 'stock_movements'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, update on public.%I from authenticated', t);
  end loop;
end;
$$;

create policy "business delete" on public.stock_items for delete to authenticated
  using (private.can_access_business(organization_id, owner_user_id, true));
-- Encomendas recebidas ou enviadas ao fornecedor não se apagam (são o histórico de compras); cancela-se.
create policy "business delete" on public.purchase_orders for delete to authenticated
  using (status in ('draft', 'cancelled') and private.can_access_business(organization_id, owner_user_id, true));

-- Movimentos: ler e registar; nunca editar nem apagar (só desaparecem com o artigo).
create policy "business read" on public.stock_movements for select to authenticated
  using (private.can_access_business(organization_id, owner_user_id, false));
create policy "business insert" on public.stock_movements for insert to authenticated
  with check (private.can_access_business(organization_id, owner_user_id, true));
revoke delete on public.stock_movements from authenticated;

-- Linhas herdam o acesso da encomenda.
create policy "read" on public.purchase_order_items for select to authenticated
  using (exists (select 1 from public.purchase_orders o where o.id = order_id and private.can_access_business(o.organization_id, o.owner_user_id, false)));
create policy "write" on public.purchase_order_items for all to authenticated
  using (exists (select 1 from public.purchase_orders o where o.id = order_id and private.can_access_business(o.organization_id, o.owner_user_id, true)))
  with check (exists (select 1 from public.purchase_orders o where o.id = order_id and private.can_access_business(o.organization_id, o.owner_user_id, true)));

grant update (name, sku, min_quantity, target_quantity, preferred_supplier_id, notes, archived_at) on public.stock_items to authenticated;
grant update (supplier_id, status, currency_code, project_id, ordered_on, expected_on, notes) on public.purchase_orders to authenticated;
grant update (position, stock_item_id, description, quantity, unit, unit_price_minor) on public.purchase_order_items to authenticated;

-- Um artigo com movimentos não se apaga (perdia-se o histórico); arquiva-se.
create or replace function private.guard_stock_item_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cascata a partir da organização ou do utilizador: permitida.
  if (old.organization_id is not null and not exists (select 1 from public.organizations o where o.id = old.organization_id))
     or (old.owner_user_id is not null and not exists (select 1 from auth.users u where u.id = old.owner_user_id)) then
    return old;
  end if;
  if exists (select 1 from public.stock_movements m where m.item_id = old.id) then
    raise exception 'stock_item_has_movements' using errcode = '22023';
  end if;
  return old;
end;
$$;
create trigger stock_items_delete before delete on public.stock_items for each row execute function private.guard_stock_item_delete();

-- ---------------------------------------------------------------------------
-- 2. Receção da encomenda
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER com verificações explícitas: business.write na encomenda e, para criar a despesa,
-- finance.write e uma conta do mesmo âmbito e moeda. Tudo ou nada.
create or replace function public.receive_purchase_order(
  p_order_id uuid,
  p_received_on date,
  p_account_id uuid default null,
  p_paid boolean default true,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_supplier public.contacts%rowtype;
  v_account public.financial_accounts%rowtype;
  v_tx uuid;
  v_line record;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if not found or not private.can_access_business(v_order.organization_id, v_order.owner_user_id, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status not in ('draft', 'ordered') then
    raise exception 'purchase_status_invalid' using errcode = '22023';
  end if;
  if p_received_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_order_items i where i.order_id = p_order_id) then
    raise exception 'purchase_empty' using errcode = '22023';
  end if;
  select * into v_supplier from public.contacts where id = v_order.supplier_id;
  if not found then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;

  if p_account_id is not null then
    if not private.can_access_finance(v_order.organization_id, v_order.owner_user_id, true) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v_account from public.financial_accounts a
    where a.id = p_account_id
      and a.organization_id is not distinct from v_order.organization_id
      and a.owner_user_id is not distinct from v_order.owner_user_id
      and a.archived_at is null;
    if not found or v_account.currency_code <> v_order.currency_code then
      raise exception 'account_invalid' using errcode = '22023';
    end if;
    if v_order.total_minor <= 0 then
      raise exception 'amount_invalid' using errcode = '22023';
    end if;
    insert into public.transactions (organization_id, owner_user_id, account_id, kind, amount_minor, currency_code, occurred_on,
                                     description, contact_id, project_id, cost_kind, settled_minor, due_on)
    values (v_order.organization_id, v_order.owner_user_id, p_account_id, 'expense', v_order.total_minor, v_order.currency_code, p_received_on,
            left(coalesce(nullif(btrim(p_description), ''), v_supplier.name), 200), v_supplier.id, v_order.project_id,
            case when v_order.project_id is not null then 'material' end,
            case when p_paid then v_order.total_minor else 0 end,
            case when p_paid then null else p_received_on + coalesce(v_supplier.payment_terms_days, 0) end)
    returning id into v_tx;
  end if;

  for v_line in select * from public.purchase_order_items i where i.order_id = p_order_id order by i.position, i.id loop
    if v_line.stock_item_id is not null then
      insert into public.stock_movements (organization_id, owner_user_id, item_id, kind, quantity, unit_cost_minor, occurred_on, purchase_order_id)
      values (v_order.organization_id, v_order.owner_user_id, v_line.stock_item_id, 'in', v_line.quantity, v_line.unit_price_minor, p_received_on, p_order_id);
    end if;
    insert into public.supplier_prices (organization_id, owner_user_id, contact_id, item_name, unit, unit_price_minor, currency_code, observed_on, transaction_id)
    values (v_order.organization_id, v_order.owner_user_id, v_supplier.id, v_line.description, v_line.unit, v_line.unit_price_minor,
            v_order.currency_code, p_received_on, v_tx);
  end loop;

  perform set_config('anen.receiving_purchase', p_order_id::text, true);
  update public.purchase_orders
  set status = 'received', received_on = p_received_on, transaction_id = v_tx,
      ordered_on = coalesce(ordered_on, p_received_on)
  where id = p_order_id;
  perform set_config('anen.receiving_purchase', '', true);
  return v_tx;
end;
$$;
revoke all on function public.receive_purchase_order(uuid, date, uuid, boolean, text) from public, anon;
grant execute on function public.receive_purchase_order(uuid, date, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reposição
-- ---------------------------------------------------------------------------
-- p_org = null: âmbito pessoal. SECURITY INVOKER: o RLS dos artigos, encomendas e contactos aplica-se.
-- Quantidade sugerida: até ao nível de reposição (ou ao mínimo, sem nível), menos o saldo e o que já está
-- em encomendas por receber. Fornecedor: o preferido; senão, o da última encomenda recebida com o artigo.
create or replace function public.stock_reorder_suggestions(p_org uuid default null)
returns table (
  item_id uuid,
  item_name text,
  unit text,
  currency_code char(3),
  quantity_on_hand numeric,
  min_quantity numeric,
  open_quantity numeric,
  suggested_quantity numeric,
  supplier_id uuid,
  supplier_name text,
  last_unit_price_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with items as (
    select s.*,
      coalesce((
        select sum(i.quantity) from public.purchase_order_items i
        join public.purchase_orders o on o.id = i.order_id
        where i.stock_item_id = s.id and o.status in ('draft', 'ordered')
      ), 0) as open_qty
    from public.stock_items s
    where s.archived_at is null
      and s.min_quantity > 0
      and s.quantity_on_hand < s.min_quantity
      and (case when p_org is null then s.owner_user_id = (select auth.uid()) else s.organization_id = p_org end)
  )
  select s.id, s.name, s.unit, s.currency_code, s.quantity_on_hand, s.min_quantity, s.open_qty,
         greatest(greatest(coalesce(s.target_quantity, 0), s.min_quantity) - s.quantity_on_hand - s.open_qty, 0),
         coalesce(s.preferred_supplier_id, last.supplier_id),
         c.name,
         last_price.unit_price_minor
  from items s
  left join lateral (
    select o.supplier_id from public.purchase_order_items i
    join public.purchase_orders o on o.id = i.order_id
    where i.stock_item_id = s.id and o.status = 'received' and o.supplier_id is not null
    order by o.received_on desc, o.updated_at desc
    limit 1
  ) last on true
  left join public.contacts c on c.id = coalesce(s.preferred_supplier_id, last.supplier_id) and c.archived_at is null
  left join lateral (
    select i.unit_price_minor from public.purchase_order_items i
    join public.purchase_orders o on o.id = i.order_id
    where i.stock_item_id = s.id and o.status = 'received' and o.supplier_id = coalesce(s.preferred_supplier_id, last.supplier_id)
    order by o.received_on desc, o.updated_at desc
    limit 1
  ) last_price on true
  where greatest(coalesce(s.target_quantity, 0), s.min_quantity) - s.quantity_on_hand - s.open_qty > 0
  order by s.name;
$$;
revoke all on function public.stock_reorder_suggestions(uuid) from public, anon;
grant execute on function public.stock_reorder_suggestions(uuid) to authenticated;

-- Um rascunho por fornecedor e moeda, com as quantidades sugeridas e o último preço pago (0 sem histórico,
-- para o utilizador preencher). Artigos sem fornecedor ficam de fora e são contados.
create or replace function public.create_reorder_drafts(p_org uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group record;
  v_order uuid;
  v_orders integer := 0;
  v_lines integer := 0;
  v_skipped integer := 0;
  v_count integer;
begin
  if p_org is null and auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.can_access_business(p_org, case when p_org is null then auth.uid() end, true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_skipped from public.stock_reorder_suggestions(p_org) r where r.supplier_name is null;
  for v_group in
    select r.supplier_id, r.currency_code from public.stock_reorder_suggestions(p_org) r
    where r.supplier_name is not null group by r.supplier_id, r.currency_code
  loop
    insert into public.purchase_orders (organization_id, owner_user_id, supplier_id, currency_code)
    values (p_org, case when p_org is null then auth.uid() end, v_group.supplier_id, v_group.currency_code)
    returning id into v_order;
    -- Os artigos de cada grupo só pertencem a esse grupo: as encomendas anteriores não os afetam.
    insert into public.purchase_order_items (order_id, position, stock_item_id, description, quantity, unit, unit_price_minor)
    select v_order, (row_number() over (order by r.item_name))::smallint - 1, r.item_id, r.item_name, r.suggested_quantity, r.unit,
           coalesce(r.last_unit_price_minor, 0)
    from public.stock_reorder_suggestions(p_org) r
    where r.supplier_id = v_group.supplier_id and r.currency_code = v_group.currency_code and r.supplier_name is not null;
    get diagnostics v_count = row_count;
    v_lines := v_lines + v_count;
    v_orders := v_orders + 1;
  end loop;
  return jsonb_build_object('orders', v_orders, 'lines', v_lines, 'skipped', v_skipped);
end;
$$;
revoke all on function public.create_reorder_drafts(uuid) from public, anon;
grant execute on function public.create_reorder_drafts(uuid) to authenticated;
