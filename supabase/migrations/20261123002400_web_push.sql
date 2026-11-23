-- Notificações push no telemóvel (app instalável / PWA).
--
-- Cada aparelho que aceita notificações guarda aqui a sua inscrição (Web Push). Uma rotina diária no servidor
-- (Vercel Cron, depois da tarefa que gera as notificações) pede à base de dados as notificações por enviar com
-- push_claim_batch e envia-as. Essa rotina NÃO usa a chave de serviço: só conhece um segredo próprio, guardado em
-- private.app_secrets, que serve apenas para estas duas funções.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  failure_count smallint not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "own" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
revoke update, truncate on public.push_subscriptions from authenticated;

alter table public.notifications add column pushed_at timestamptz;
create index notifications_push_pending_idx on public.notifications (created_at) where pushed_at is null and read_at is null and dismissed_at is null;

create table private.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
revoke all on private.app_secrets from public, anon, authenticated;
insert into private.app_secrets (key, value)
values ('push_dispatch', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function private.check_app_secret(p_key text, p_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_secrets s where s.key = p_key and p_value is not null and s.value = p_value);
$$;
revoke all on function private.check_app_secret(text, text) from public, anon, authenticated;

-- Notificações por enviar (últimos 2 dias, nem lidas nem apagadas) × inscrições da pessoa. Marca-as como enviadas
-- (pushed_at) na mesma chamada, para duas rotinas ao mesmo tempo não enviarem duas vezes.
create or replace function public.push_claim_batch(p_secret text, p_limit integer default 300)
returns table (
  notification_id uuid,
  subscription_id uuid,
  kind text,
  data jsonb,
  link text,
  organization_id uuid,
  language_code text,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.check_app_secret('push_dispatch', p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null and n.read_at is null and n.dismissed_at is null
      and n.created_at >= now() - interval '2 days'
      and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 300), 1), 1000)
    for update skip locked
  ), marked as (
    update public.notifications n set pushed_at = now()
    from picked where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.data, n.link, n.organization_id
  )
  select m.id, s.id, m.kind, m.data, m.link, m.organization_id, coalesce(up.language_code, 'pt-PT'), s.endpoint, s.p256dh, s.auth
  from marked m
  join public.push_subscriptions s on s.user_id = m.user_id
  left join public.user_preferences up on up.user_id = m.user_id;
end;
$$;
revoke all on function public.push_claim_batch(text, integer) from public;
grant execute on function public.push_claim_batch(text, integer) to anon, authenticated;

-- Resultado do envio a uma inscrição: sucesso limpa as falhas; "gone" (404/410) apaga; 5 falhas seguidas apagam.
create or replace function public.push_report(p_secret text, p_subscription_id uuid, p_ok boolean, p_gone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.check_app_secret('push_dispatch', p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ok then
    update public.push_subscriptions set failure_count = 0, last_success_at = now() where id = p_subscription_id;
  elsif p_gone then
    delete from public.push_subscriptions where id = p_subscription_id;
  else
    update public.push_subscriptions set failure_count = failure_count + 1 where id = p_subscription_id;
    delete from public.push_subscriptions where id = p_subscription_id and failure_count >= 5;
  end if;
end;
$$;
revoke all on function public.push_report(text, uuid, boolean, boolean) from public;
grant execute on function public.push_report(text, uuid, boolean, boolean) to anon, authenticated;
