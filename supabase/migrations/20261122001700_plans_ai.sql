-- ANEN · Planos (Free, Pro, Max) e ANEN AI.
--
-- 1. Planos com limites em dados (editáveis pelos administradores da plataforma, sem mudar código).
--    A ANEN AI só existe no Pro e no Max (pedido do dono, 22/11/2026), com limite diário de perguntas
--    por conta (pessoal ou organização): Pro 25, Max 100. Free = 0 (sem IA).
-- 2. Subscrição por âmbito (pessoa ou organização). Ainda sem cobrança: os administradores atribuem o plano
--    (source = 'manual'); a cobrança (Stripe) entra depois por este mesmo modelo. Sem subscrição ativa = Free.
-- 3. Conversas da IA: de quem pergunta (privadas), no contexto (pessoal/organização) em que foram feitas.
-- 4. Uso diário (ai_usage): cada pergunta reserva uma vaga ANTES de chamar o modelo, numa função com trava
--    por âmbito, no dia do fuso do âmbito. O limite é aplicado no servidor, nunca só na interface.

-- ---------------------------------------------------------------------------
-- 1. Planos
-- ---------------------------------------------------------------------------
create table public.plans (
  key text primary key check (key in ('free', 'pro', 'max')),
  name text not null,
  position smallint not null,
  ai_daily_limit integer not null check (ai_daily_limit between 0 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.plans (key, name, position, ai_daily_limit) values
  ('free', 'Free', 1, 0),
  ('pro', 'Pro', 2, 25),
  ('max', 'Max', 3, 100);

alter table public.plans enable row level security;
create policy "read" on public.plans for select to authenticated using (true);
revoke all on public.plans from anon;
revoke insert, update, delete, truncate on public.plans from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Subscrições
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  plan_key text not null references public.plans (key),
  status text not null default 'active' check (status in ('active', 'canceled')),
  source text not null default 'manual' check (source in ('manual', 'stripe')),
  current_period_end timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index subscriptions_org_active_idx on public.subscriptions (organization_id) where status = 'active' and organization_id is not null;
create unique index subscriptions_owner_active_idx on public.subscriptions (owner_user_id) where status = 'active' and owner_user_id is not null;
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();
create trigger subscriptions_audit after insert or update or delete on public.subscriptions for each row execute function private.audit_row_change();

alter table public.subscriptions enable row level security;
create policy "scope read" on public.subscriptions for select to authenticated
  using ((owner_user_id = (select auth.uid())) or (organization_id is not null and private.is_org_member(organization_id)));
revoke all on public.subscriptions from anon;
revoke insert, update, delete, truncate on public.subscriptions from authenticated;

-- Plano em vigor de um âmbito (sem subscrição ativa e dentro do prazo = free).
create or replace function private.current_plan(p_org uuid, p_owner uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.plans p
  where p.key = coalesce((
    select s.plan_key from public.subscriptions s
    where s.status = 'active'
      and (s.current_period_end is null or s.current_period_end > now())
      and ((p_org is not null and s.organization_id = p_org) or (p_org is null and s.owner_user_id = p_owner))
    limit 1
  ), 'free');
$$;
revoke all on function private.current_plan(uuid, uuid) from public, anon, authenticated;

-- Administradores da plataforma atribuem ou trocam o plano (até haver cobrança).
create or replace function public.admin_set_plan(p_org uuid, p_owner uuid, p_plan text, p_until timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_org is null) = (p_owner is null) or not exists (select 1 from public.plans where key = p_plan) then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
  update public.subscriptions set status = 'canceled'
  where status = 'active' and ((p_org is not null and organization_id = p_org) or (p_owner is not null and owner_user_id = p_owner));
  insert into public.subscriptions (organization_id, owner_user_id, plan_key, current_period_end, created_by)
  values (p_org, p_owner, p_plan, p_until, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_set_plan(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_set_plan(uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.admin_set_ai_limit(p_plan text, p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.plans set ai_daily_limit = p_limit, updated_at = now() where key = p_plan;
  if not found then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.admin_set_ai_limit(text, integer) from public, anon;
grant execute on function public.admin_set_ai_limit(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Conversas
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 20000),
  -- Ferramentas usadas e registos consultados (gerado pelo servidor, não pelo modelo).
  sources jsonb not null default '[]'::jsonb,
  -- Ferramentas que a IA chamou para responder (nomes internos).
  tools text[] not null default '{}' check (cardinality(tools) <= 30),
  model text,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

create trigger ai_conversations_updated_at before update on public.ai_conversations
  for each row execute function private.set_updated_at();

-- Consentimento: a pessoa aceita que as perguntas e os dados consultados vão ao fornecedor do modelo.
create table public.ai_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  accepted_at timestamptz not null default now()
);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_consents enable row level security;

-- Só a própria pessoa; nas de organização, só enquanto for membro ativo.
create policy "own" on public.ai_conversations for all to authenticated
  using (user_id = (select auth.uid()) and (organization_id is null or private.is_org_member(organization_id)))
  with check (user_id = (select auth.uid()) and (organization_id is null or private.is_org_member(organization_id)));
create policy "own" on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())
                 and (c.organization_id is null or private.is_org_member(c.organization_id))))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())
                      and (c.organization_id is null or private.is_org_member(c.organization_id))));
create policy "own" on public.ai_consents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.ai_conversations, public.ai_messages, public.ai_consents from anon;
revoke truncate, update on public.ai_conversations, public.ai_messages, public.ai_consents from authenticated;
grant update (title) on public.ai_conversations to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Uso diário
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  day date not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  created_at timestamptz not null default now(),
  constraint ai_usage_scope check ((organization_id is null) <> (owner_user_id is null))
);
create index ai_usage_org_day_idx on public.ai_usage (organization_id, day) where organization_id is not null;
create index ai_usage_owner_day_idx on public.ai_usage (owner_user_id, day) where owner_user_id is not null;
alter table public.ai_usage enable row level security;
create policy "platform admins read" on public.ai_usage for select to authenticated using (private.is_platform_admin());
revoke all on public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_usage from authenticated;

-- Dia de hoje no fuso do âmbito (organização ou preferências da pessoa).
create or replace function private.scope_today(p_org uuid, p_owner uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    case when p_org is not null then (select o.timezone from public.organizations o where o.id = p_org)
         else (select up.timezone from public.user_preferences up where up.user_id = p_owner) end,
    'UTC'))::date;
$$;
revoke all on function private.scope_today(uuid, uuid) from public, anon, authenticated;

-- Estado da IA para o âmbito atual: plano, limite, usado hoje, consentimento.
create or replace function public.ai_status(p_org uuid default null)
returns table (plan_key text, plan_name text, daily_limit integer, used_today integer, consented boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := case when p_org is null then auth.uid() end;
  v_plan public.plans;
begin
  if auth.uid() is null or (p_org is not null and not private.is_org_member(p_org)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_plan := private.current_plan(p_org, v_owner);
  return query
  select v_plan.key, v_plan.name, v_plan.ai_daily_limit,
         (select count(*)::integer from public.ai_usage u
          where u.day = private.scope_today(p_org, v_owner) and u.status <> 'failed'
            and ((p_org is not null and u.organization_id = p_org) or (p_org is null and u.owner_user_id = v_owner))),
         exists (select 1 from public.ai_consents c where c.user_id = auth.uid());
end;
$$;
revoke all on function public.ai_status(uuid) from public, anon;
grant execute on function public.ai_status(uuid) to authenticated;

-- Reserva uma pergunta. Erros: ai_plan_required (Free), ai_daily_limit (acabou o limite de hoje), ai_consent_required.
create or replace function public.ai_begin_request(p_org uuid default null)
returns table (usage_id bigint, daily_limit integer, used_today integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := case when p_org is null then auth.uid() end;
  v_plan public.plans;
  v_day date;
  v_used integer;
  v_id bigint;
begin
  if auth.uid() is null or (p_org is not null and not private.is_org_member(p_org)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ai_consents c where c.user_id = auth.uid()) then
    raise exception 'ai_consent_required' using errcode = '22023';
  end if;
  v_plan := private.current_plan(p_org, v_owner);
  if v_plan.ai_daily_limit <= 0 then
    raise exception 'ai_plan_required' using errcode = '22023';
  end if;
  -- Uma reserva de cada vez por âmbito: dois pedidos ao mesmo tempo não passam o limite.
  perform pg_advisory_xact_lock(hashtext('ai:' || coalesce(p_org, v_owner)::text));
  v_day := private.scope_today(p_org, v_owner);
  select count(*)::integer into v_used from public.ai_usage u
  where u.day = v_day and u.status <> 'failed'
    and ((p_org is not null and u.organization_id = p_org) or (p_org is null and u.owner_user_id = v_owner));
  if v_used >= v_plan.ai_daily_limit then
    raise exception 'ai_daily_limit' using errcode = '22023';
  end if;
  insert into public.ai_usage (organization_id, owner_user_id, user_id, day)
  values (p_org, v_owner, auth.uid(), v_day)
  returning id into v_id;
  return query select v_id, v_plan.ai_daily_limit, v_used + 1;
end;
$$;
revoke all on function public.ai_begin_request(uuid) from public, anon;
grant execute on function public.ai_begin_request(uuid) to authenticated;

-- Fecha a reserva com o consumo; uma falha do fornecedor devolve a vaga (status failed não conta).
create or replace function public.ai_finish_request(p_usage_id bigint, p_ok boolean, p_model text, p_input integer, p_output integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_usage set status = case when p_ok then 'done' else 'failed' end,
    model = left(p_model, 80), input_tokens = greatest(coalesce(p_input, 0), 0), output_tokens = greatest(coalesce(p_output, 0), 0)
  where id = p_usage_id and user_id = auth.uid() and status = 'reserved';
end;
$$;
revoke all on function public.ai_finish_request(bigint, boolean, text, integer, integer) from public, anon;
grant execute on function public.ai_finish_request(bigint, boolean, text, integer, integer) to authenticated;
