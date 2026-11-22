-- ANEN · Prompt 03 · Fase 9: notificações, relatórios e otimização.
--
-- 1. Notificações na aplicação (sem email: ainda não há SMTP). Uma notificação é de uma pessoa, opcionalmente
--    no contexto de uma organização. São criadas pelo servidor (tarefa diária e ao abrir a página), nunca pelo
--    cliente, e não se repetem (dedupe_key por pessoa). Tipos:
--      payment_overdue      movimento por liquidar com vencimento ultrapassado (finance.read)
--      payment_due_soon     vence nos próximos N dias, N configurável por pessoa (finance.read)
--      stock_below_minimum  artigo abaixo do mínimo, uma vez por episódio (business.read)
--      purchase_late        encomenda enviada com entrega prevista ultrapassada (business.read)
--      market_alert         alerta do agente de mercado (business.read)
--    Cada pessoa pode desligar tipos e escolher a antecedência (notification_settings).
-- 2. Relatórios: finance_report agrega por categoria, contacto, projeto e centro de custo, com o valor
--    faturado (amount_minor) e o liquidado (settled_minor), no período pedido.
-- 3. Índices para as consultas novas.

-- ---------------------------------------------------------------------------
-- 1. Notificações
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('payment_overdue', 'payment_due_soon', 'stock_below_minimum', 'purchase_late', 'market_alert')),
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  link text check (link ~ '^/[A-Za-z0-9/_?=&.-]*$' and char_length(link) <= 300),
  dedupe_key text not null check (char_length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  disabled_kinds text[] not null default '{}'
    check (disabled_kinds <@ array['payment_overdue', 'payment_due_soon', 'stock_below_minimum', 'purchase_late', 'market_alert']),
  due_soon_days smallint not null default 3 check (due_soon_days between 1 and 30),
  updated_at timestamptz not null default now()
);
create trigger notification_settings_updated_at before update on public.notification_settings
  for each row execute function private.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;

-- Cada pessoa vê as suas; as de uma organização só enquanto for membro ativo com a permissão do tipo
-- (finanças para pagamentos; negócio para stock, compras e mercado).
create policy "own read" on public.notifications for select to authenticated
  using (
    user_id = (select auth.uid())
    and (organization_id is null or private.has_org_permission(
      organization_id,
      case when kind in ('payment_overdue', 'payment_due_soon') then 'finance.read' else 'business.read' end
    ))
  );
create policy "own update" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own delete" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update, truncate on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "own" on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notification_settings from anon;
revoke truncate, update on public.notification_settings from authenticated;
grant update (disabled_kinds, due_soon_days) on public.notification_settings to authenticated;

-- Gera as notificações em falta. p_user = null: todas as pessoas (tarefa diária); senão, só essa pessoa.
-- Idempotente (on conflict do nothing). Respeita as preferências de cada pessoa.
create or replace function private.generate_notifications(p_today date default current_date, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_rows integer;
begin
  -- Quem recebe o quê: a própria pessoa para os dados pessoais; os membros ativos com a permissão para os da organização.
  create temporary table if not exists notif_audience (user_id uuid, organization_id uuid, owner_user_id uuid, permission text) on commit drop;
  truncate notif_audience;
  insert into notif_audience
  select u.id, null, u.id, p.permission
  from auth.users u cross join (values ('finance.read'), ('business.read')) as p(permission)
  where p_user is null or u.id = p_user;
  insert into notif_audience
  select m.user_id, m.organization_id, null, rp.permission_key
  from public.organization_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.status = 'active' and rp.permission_key in ('finance.read', 'business.read')
    and (p_user is null or m.user_id = p_user);

  -- Pagamentos vencidos (uma vez por movimento e vencimento).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'payment_overdue', t.id,
         jsonb_build_object('description', t.description, 'direction', t.kind, 'remaining_minor', t.amount_minor - t.settled_minor,
                            'currency', t.currency_code, 'due_on', t.due_on),
         '/financas/em-aberto', 'overdue:' || t.id || ':' || t.due_on
  from notif_audience a
  join public.transactions t
    on t.organization_id is not distinct from a.organization_id and t.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'finance.read'
    and t.settled_minor < t.amount_minor and t.due_on is not null and t.due_on < p_today
    and not ('payment_overdue' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- A vencer nos próximos N dias.
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'payment_due_soon', t.id,
         jsonb_build_object('description', t.description, 'direction', t.kind, 'remaining_minor', t.amount_minor - t.settled_minor,
                            'currency', t.currency_code, 'due_on', t.due_on),
         '/financas/em-aberto', 'due:' || t.id || ':' || t.due_on
  from notif_audience a
  join public.transactions t
    on t.organization_id is not distinct from a.organization_id and t.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'finance.read'
    and t.settled_minor < t.amount_minor and t.due_on is not null
    and t.due_on between p_today and p_today + coalesce(s.due_soon_days, 3)
    and not ('payment_due_soon' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Stock abaixo do mínimo: uma vez por episódio (desde a última vez que esteve no mínimo ou acima).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'stock_below_minimum', i.id,
         jsonb_build_object('name', i.name, 'quantity', i.quantity_on_hand, 'minimum', i.min_quantity, 'unit', i.unit),
         '/inventario/' || i.id,
         'stock:' || i.id || ':' || coalesce((
           select mv.id::text from public.stock_movements mv
           where mv.item_id = i.id and mv.balance_after >= i.min_quantity
           order by mv.created_at desc limit 1
         ), 'start')
  from notif_audience a
  join public.stock_items i
    on i.organization_id is not distinct from a.organization_id and i.owner_user_id is not distinct from a.owner_user_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and i.archived_at is null and i.min_quantity > 0 and i.quantity_on_hand < i.min_quantity
    and not ('stock_below_minimum' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Encomendas atrasadas.
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'purchase_late', o.id,
         jsonb_build_object('supplier', c.name, 'expected_on', o.expected_on, 'total_minor', o.total_minor, 'currency', o.currency_code),
         '/compras/' || o.id, 'late:' || o.id || ':' || o.expected_on
  from notif_audience a
  join public.purchase_orders o
    on o.organization_id is not distinct from a.organization_id and o.owner_user_id is not distinct from a.owner_user_id
  left join public.contacts c on c.id = o.supplier_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and o.status = 'ordered' and o.expected_on is not null and o.expected_on < p_today
    and not ('purchase_late' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Alertas do agente de mercado (dos últimos 60 dias, para não inundar quem chega agora).
  insert into public.notifications (user_id, organization_id, kind, entity_id, data, link, dedupe_key)
  select a.user_id, a.organization_id, 'market_alert', al.id,
         jsonb_build_object('series', se.name, 'period', al.period, 'change_month', al.change_month, 'threshold', al.threshold_percent),
         '/mercado', 'market:' || al.id
  from notif_audience a
  join public.market_alerts al
    on al.organization_id is not distinct from a.organization_id and al.owner_user_id is not distinct from a.owner_user_id
  join public.market_series se on se.id = al.series_id
  left join public.notification_settings s on s.user_id = a.user_id
  where a.permission = 'business.read'
    and al.created_at >= p_today - 60
    and not ('market_alert' = any (coalesce(s.disabled_kinds, '{}')))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  return v_count;
end;
$$;
revoke all on function private.generate_notifications(date, uuid) from public, anon, authenticated;

-- A pessoa atualiza as suas notificações ao abrir a página (sem esperar pela tarefa diária).
create or replace function public.refresh_my_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.generate_notifications(current_date, auth.uid());
end;
$$;
revoke all on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

-- Tarefa diária: gera para todas as pessoas e limpa as antigas (lidas há mais de 90 dias, qualquer uma com mais de 180).
create or replace function private.run_notification_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_created integer;
  v_deleted integer;
begin
  insert into public.job_runs (job) values ('notifications') returning id into v_run;
  begin
    v_created := private.generate_notifications(current_date, null);
    delete from public.notifications
    where (read_at is not null and read_at < now() - interval '90 days') or created_at < now() - interval '180 days';
    get diagnostics v_deleted = row_count;
    update public.job_runs set finished_at = now(), status = 'success', processed = v_created,
      details = jsonb_build_object('created', v_created, 'deleted', v_deleted)
    where id = v_run;
  exception when others then
    update public.job_runs set finished_at = now(), status = 'error', details = jsonb_build_object('error', sqlerrm) where id = v_run;
  end;
end;
$$;
revoke all on function private.run_notification_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('anen-notifications', '45 6 * * *', 'select private.run_notification_jobs()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Relatórios
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: o RLS de transactions (finance.read) aplica-se. Faturado = amount_minor; liquidado = settled_minor.
create or replace function public.finance_report(p_org uuid, p_from date, p_to date)
returns table (
  dimension text,
  key uuid,
  currency_code char(3),
  income_total bigint,
  income_settled bigint,
  expense_total bigint,
  expense_settled bigint,
  count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select t.* from public.transactions t
    where ((p_org is null and t.owner_user_id = (select auth.uid())) or (p_org is not null and t.organization_id = p_org))
      and t.occurred_on between p_from and p_to
  )
  select case
           when grouping(b.category_id) = 0 then 'category'
           when grouping(b.contact_id) = 0 then 'contact'
           when grouping(b.project_id) = 0 then 'project'
           when grouping(b.cost_center_id) = 0 then 'cost_center'
           else 'total'
         end,
         coalesce(b.category_id, b.contact_id, b.project_id, b.cost_center_id),
         b.currency_code,
         coalesce(sum(b.amount_minor) filter (where b.kind = 'income'), 0)::bigint,
         coalesce(sum(b.settled_minor) filter (where b.kind = 'income'), 0)::bigint,
         coalesce(sum(b.amount_minor) filter (where b.kind = 'expense'), 0)::bigint,
         coalesce(sum(b.settled_minor) filter (where b.kind = 'expense'), 0)::bigint,
         count(*)::bigint
  from base b
  group by grouping sets (
    (b.currency_code),
    (b.category_id, b.currency_code),
    (b.contact_id, b.currency_code),
    (b.project_id, b.currency_code),
    (b.cost_center_id, b.currency_code)
  )
  order by 1, 3;
$$;
revoke all on function public.finance_report(uuid, date, date) from public, anon;
grant execute on function public.finance_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
create index if not exists transactions_contact_idx on public.transactions (contact_id) where contact_id is not null;
create index if not exists transactions_project_idx on public.transactions (project_id) where project_id is not null;
create index if not exists purchase_orders_late_idx on public.purchase_orders (expected_on) where status = 'ordered';
create index if not exists stock_items_below_idx on public.stock_items (organization_id, owner_user_id) where archived_at is null and min_quantity > 0;
