-- Dual Workspace · Fase 9 (§11): limites por plano (Free, Pro, Max), configuráveis e validados na base de dados.
-- Valores versionados (data de vigência e fonte), nunca no código. A pedido do dono da app (27/11/2026), começam
-- todos SEM LIMITE (null); o limite diário da IA continua em plans.ai_daily_limit.
-- Direitos da conta vs. do espaço: o limite de organizações usa o plano da conta (subscrição pessoal de quem cria);
-- os restantes usam o plano do espaço onde o registo é criado. Uma conta com vários espaços não paga duas vezes:
-- cada subscrição é de um espaço (subscriptions já é por âmbito).
-- Aprovado pelo dono da app a 27/11/2026. Não altera nem apaga dados existentes.
-- Reversão: drop trigger <tabela>_plan_limit em organizations, organization_members, projects, quotes, market_watches;
--           drop function private.enforce_plan_limit_trigger(); drop function public.admin_set_plan_limit(text, text, integer, text);
--           drop function private.plan_limit(text, text); drop table public.plan_limits;

create table public.plan_limits (
  plan_key text not null references public.plans (key),
  limit_key text not null check (limit_key in ('organizations', 'members', 'projects', 'quotes_per_month', 'market_watches')),
  -- null = sem limite
  value integer check (value is null or value between 0 and 1000000),
  valid_from date not null,
  source text not null check (char_length(btrim(source)) between 1 and 300),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (plan_key, limit_key, valid_from)
);

insert into public.plan_limits (plan_key, limit_key, value, valid_from, source)
select p.key, l.key, null, date '2026-11-27', 'Sem limite definido pelo dono da app (decisão de 27/11/2026)'
from public.plans p cross join (values ('organizations'), ('members'), ('projects'), ('quotes_per_month'), ('market_watches')) as l (key);

alter table public.plan_limits enable row level security;
create policy "read" on public.plan_limits for select to authenticated using (true);
revoke all on public.plan_limits from public, anon, authenticated;
grant select on public.plan_limits to authenticated;

-- Limite em vigor (o registo com a data de vigência mais recente que já começou). null = sem limite.
create or replace function private.plan_limit(p_plan text, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select l.value from public.plan_limits l
  where l.plan_key = p_plan and l.limit_key = p_key and l.valid_from <= current_date
  order by l.valid_from desc
  limit 1;
$$;
revoke all on function private.plan_limit(text, text) from public, anon, authenticated;

-- Administradores da plataforma definem um limite novo (nova versão, em vigor a partir de hoje).
create or replace function public.admin_set_plan_limit(p_plan text, p_key text, p_value integer, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans where key = p_plan) or char_length(btrim(coalesce(p_source, ''))) = 0 then
    raise exception 'plan_invalid' using errcode = '22023';
  end if;
  insert into public.plan_limits (plan_key, limit_key, value, valid_from, source, updated_by)
  values (p_plan, p_key, p_value, current_date, btrim(p_source), auth.uid())
  on conflict (plan_key, limit_key, valid_from) do update set value = excluded.value, source = excluded.source, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.admin_set_plan_limit(text, text, integer, text) from public, anon;
grant execute on function public.admin_set_plan_limit(text, text, integer, text) to authenticated;

-- Verificação ao criar: conta os registos existentes do âmbito e recusa quando o limite já foi atingido.
create or replace function private.enforce_plan_limit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := tg_argv[0];
  v_plan text;
  v_limit integer;
  v_count bigint;
begin
  if v_key = 'organizations' then
    -- Direito da conta: o plano pessoal de quem cria a organização.
    if coalesce(new.created_by, auth.uid()) is null then
      return new;
    end if;
    v_plan := (private.current_plan(null, coalesce(new.created_by, auth.uid()))).key;
    v_limit := private.plan_limit(v_plan, v_key);
    if v_limit is null then return new; end if;
    select count(*) into v_count from public.organizations o where o.created_by = coalesce(new.created_by, auth.uid());
  elsif v_key = 'members' then
    if new.status <> 'active' then
      return new;
    end if;
    v_plan := (private.current_plan(new.organization_id, null)).key;
    v_limit := private.plan_limit(v_plan, v_key);
    if v_limit is null then return new; end if;
    select count(*) into v_count from public.organization_members m where m.organization_id = new.organization_id and m.status = 'active';
  else
    v_plan := (private.current_plan(new.organization_id, new.owner_user_id)).key;
    v_limit := private.plan_limit(v_plan, v_key);
    if v_limit is null then return new; end if;
    if v_key = 'projects' then
      select count(*) into v_count from public.projects x
      where x.organization_id is not distinct from new.organization_id and x.owner_user_id is not distinct from new.owner_user_id;
    elsif v_key = 'quotes_per_month' then
      select count(*) into v_count from public.quotes x
      where x.organization_id is not distinct from new.organization_id and x.owner_user_id is not distinct from new.owner_user_id
        and x.created_at >= date_trunc('month', now());
    elsif v_key = 'market_watches' then
      select count(*) into v_count from public.market_watches x
      where x.organization_id is not distinct from new.organization_id and x.owner_user_id is not distinct from new.owner_user_id;
    else
      return new;
    end if;
  end if;
  if v_count >= v_limit then
    raise exception 'plan_limit_reached' using errcode = '22023', detail = v_key;
  end if;
  return new;
end;
$$;

create trigger organizations_plan_limit before insert on public.organizations
  for each row execute function private.enforce_plan_limit_trigger('organizations');
create trigger organization_members_plan_limit before insert on public.organization_members
  for each row execute function private.enforce_plan_limit_trigger('members');
create trigger projects_plan_limit before insert on public.projects
  for each row execute function private.enforce_plan_limit_trigger('projects');
create trigger quotes_plan_limit before insert on public.quotes
  for each row execute function private.enforce_plan_limit_trigger('quotes_per_month');
create trigger market_watches_plan_limit before insert on public.market_watches
  for each row execute function private.enforce_plan_limit_trigger('market_watches');
