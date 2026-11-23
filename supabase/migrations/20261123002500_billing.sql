-- Assinaturas pagas dos planos Pro e Max.
--
-- Preços em dados (plan_prices), com data de início: mudar um preço é inserir uma linha nova.
-- Brasil: Checkout da InfinitePay (Pix ou cartão). Cada pagamento ativa um período (1 ou 12 meses); sem renovação, o
-- plano volta ao Free quando o período acaba (private.current_plan já respeita current_period_end).
-- Portugal: transferência por IBAN, confirmada à mão por um administrador da plataforma (fica para quando houver IBAN).
--
-- O aviso da InfinitePay não tem assinatura: o servidor confirma SEMPRE com payment_check antes de chamar
-- billing_confirm, que só aceita o segredo próprio 'billing' (private.app_secrets) — sem chave de serviço.

create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references public.plans (key) check (plan_key in ('pro', 'max')),
  currency_code char(3) not null references public.currencies (code),
  months smallint not null check (months in (1, 12)),
  price_minor bigint not null check (price_minor > 0 and price_minor <= 9007199254740991),
  valid_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (plan_key, currency_code, months, valid_from)
);
alter table public.plan_prices enable row level security;
create policy "read" on public.plan_prices for select to authenticated using (true);
revoke all on public.plan_prices from anon;
revoke insert, update, delete, truncate on public.plan_prices from authenticated;

-- Preços de lançamento (23/11/2026): anual = 10 meses.
insert into public.plan_prices (plan_key, currency_code, months, price_minor, valid_from) values
  ('pro', 'BRL', 1, 1490, '2026-11-23'), ('pro', 'BRL', 12, 14900, '2026-11-23'),
  ('max', 'BRL', 1, 2990, '2026-11-23'), ('max', 'BRL', 12, 29900, '2026-11-23'),
  ('pro', 'EUR', 1, 399, '2026-11-23'), ('pro', 'EUR', 12, 3990, '2026-11-23'),
  ('max', 'EUR', 1, 799, '2026-11-23'), ('max', 'EUR', 12, 7990, '2026-11-23');

-- Preço em vigor hoje.
create or replace function private.plan_price(p_plan text, p_currency text, p_months integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pp.price_minor from public.plan_prices pp
  where pp.plan_key = p_plan and pp.currency_code = p_currency and pp.months = p_months and pp.valid_from <= current_date
  order by pp.valid_from desc limit 1;
$$;
revoke all on function private.plan_price(text, text, integer) from public, anon, authenticated;

alter table public.subscriptions drop constraint subscriptions_source_check;
alter table public.subscriptions add constraint subscriptions_source_check check (source in ('manual', 'stripe', 'infinitepay', 'bank_transfer'));

create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  order_nsu text not null unique,
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  plan_key text not null references public.plans (key),
  months smallint not null check (months in (1, 12)),
  currency_code char(3) not null references public.currencies (code),
  amount_minor bigint not null check (amount_minor > 0),
  provider text not null check (provider in ('infinitepay', 'bank_transfer')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  provider_ref text check (char_length(provider_ref) <= 200),
  paid_minor bigint,
  paid_at timestamptz,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_orders_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index billing_orders_owner_idx on public.billing_orders (owner_user_id, created_at desc) where owner_user_id is not null;
create index billing_orders_org_idx on public.billing_orders (organization_id, created_at desc) where organization_id is not null;
create trigger billing_orders_audit after insert or update on public.billing_orders for each row execute function private.audit_row_change();

alter table public.billing_orders enable row level security;
create policy "scope read" on public.billing_orders for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (organization_id is not null and private.has_org_permission(organization_id, 'organization.update'))
    or private.is_platform_admin()
  );
revoke all on public.billing_orders from anon;
revoke insert, update, delete, truncate on public.billing_orders from authenticated;

insert into private.app_secrets (key, value)
values ('billing', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Cria o pedido (o valor vem SEMPRE da tabela de preços, nunca do navegador).
-- Pessoal: a própria pessoa. Organização: quem pode alterar a organização.
create or replace function public.create_billing_order(p_org uuid, p_plan text, p_months integer, p_currency text, p_provider text)
returns table (id uuid, order_nsu text, amount_minor bigint, currency_code char(3))
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_price bigint;
  v_nsu text;
begin
  if p_org is not null and not private.has_org_permission(p_org, 'organization.update') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_provider not in ('infinitepay', 'bank_transfer') or (p_provider = 'infinitepay' and p_currency <> 'BRL') then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
  v_price := private.plan_price(p_plan, p_currency, p_months);
  if v_price is null then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
  v_nsu := 'anen-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  return query
  insert into public.billing_orders (order_nsu, organization_id, owner_user_id, plan_key, months, currency_code, amount_minor, provider, created_by)
  values (v_nsu, p_org, case when p_org is null then v_uid end, p_plan, p_months, p_currency, v_price, p_provider, v_uid)
  returning billing_orders.id, billing_orders.order_nsu, billing_orders.amount_minor, billing_orders.currency_code;
end;
$$;
revoke all on function public.create_billing_order(uuid, text, integer, text, text) from public, anon;
grant execute on function public.create_billing_order(uuid, text, integer, text, text) to authenticated;

-- Ativa o pedido pago (idempotente). Renovar o mesmo plano soma ao fim do período atual; mudar de plano começa hoje.
create or replace function private.activate_billing_order(p_order public.billing_orders, p_paid bigint, p_ref text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.subscriptions%rowtype;
  v_start timestamptz := now();
  v_sub uuid;
begin
  select * into v_current from public.subscriptions s
  where s.status = 'active'
    and ((p_order.organization_id is not null and s.organization_id = p_order.organization_id)
      or (p_order.owner_user_id is not null and s.owner_user_id = p_order.owner_user_id))
  for update;
  if found and v_current.plan_key = p_order.plan_key and v_current.current_period_end > now() then
    v_start := v_current.current_period_end;
  end if;
  update public.subscriptions set status = 'canceled'
  where status = 'active'
    and ((p_order.organization_id is not null and organization_id = p_order.organization_id)
      or (p_order.owner_user_id is not null and owner_user_id = p_order.owner_user_id));
  insert into public.subscriptions (organization_id, owner_user_id, plan_key, source, current_period_end, created_by)
  values (p_order.organization_id, p_order.owner_user_id, p_order.plan_key, p_order.provider,
          v_start + make_interval(months => p_order.months), p_order.created_by)
  returning id into v_sub;
  update public.billing_orders
  set status = 'paid', paid_minor = p_paid, paid_at = now(), provider_ref = left(p_ref, 200), subscription_id = v_sub
  where id = p_order.id;
  return v_sub;
end;
$$;
revoke all on function private.activate_billing_order(public.billing_orders, bigint, text) from public, anon, authenticated;

-- Chamado pelo servidor depois de a InfinitePay confirmar o pagamento (payment_check).
create or replace function public.billing_confirm(p_secret text, p_order_nsu text, p_paid_minor bigint, p_ref text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.billing_orders%rowtype;
begin
  if not private.check_app_secret('billing', p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_order from public.billing_orders where order_nsu = p_order_nsu and provider = 'infinitepay' for update;
  if not found then
    return 'not_found';
  end if;
  if v_order.status = 'paid' then
    return 'already_paid';
  end if;
  if v_order.status <> 'pending' or p_paid_minor is null or p_paid_minor < v_order.amount_minor then
    return 'rejected';
  end if;
  perform private.activate_billing_order(v_order, p_paid_minor, p_ref);
  return 'paid';
end;
$$;
revoke all on function public.billing_confirm(text, text, bigint, text) from public;
grant execute on function public.billing_confirm(text, text, bigint, text) to anon, authenticated;

-- Transferência por IBAN: um administrador da plataforma confirma depois de ver o dinheiro na conta.
create or replace function public.admin_confirm_billing(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.billing_orders%rowtype;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_order from public.billing_orders where id = p_order_id and status = 'pending' for update;
  if not found then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
  return private.activate_billing_order(v_order, v_order.amount_minor, 'manual:' || auth.uid());
end;
$$;
revoke all on function public.admin_confirm_billing(uuid) from public, anon;
grant execute on function public.admin_confirm_billing(uuid) to authenticated;
