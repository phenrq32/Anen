-- Dual Workspace · Fase 2 (opção A de DUAL_ARCHITECTURE_AUDIT.md §6).
-- Camada "workspace" sobre o modelo existente, sem mover dados:
--   PERSONAL = o utilizador (registos com owner_user_id); id do workspace = id do utilizador.
--   BUSINESS = uma organização (registos com organization_id); id do workspace = id da organização.
-- As vistas são security_invoker: o RLS das tabelas de origem decide o que cada pessoa vê.
-- Reversão: drop view public.workspace_members, public.workspaces;
--           drop function public.ensure_personal_workspace(), public.can_access_workspace(text, uuid, text),
--                         private.can_access_workspace(text, uuid, text);

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------

create view public.workspaces
with (security_invoker = true)
as
  -- Pessoal: só a própria linha (user_preferences só é legível pelo próprio).
  select p.user_id as id,
         'PERSONAL'::text as type,
         null::text as name, -- a interface mostra "Pessoal" no idioma de quem vê
         null::public.organization_kind as organization_kind,
         p.user_id as owner_user_id,
         p.country_code::text as country_code,
         null::uuid as region_id,
         p.currency_code::text as currency_code,
         p.timezone,
         p.language_code,
         p.created_at,
         p.updated_at
  from public.user_preferences p
  union all
  -- Empresarial: organizações em que a pessoa é membro ativo (política de organizations).
  -- owner_user_id é quem a criou; os proprietários atuais estão em workspace_members (role_key = 'owner').
  select o.id,
         'BUSINESS'::text,
         o.name,
         o.kind,
         o.created_by,
         o.country_code::text,
         o.region_id,
         o.currency_code::text,
         o.timezone,
         null::text, -- a organização não tem idioma: cada membro usa o seu
         o.created_at,
         o.updated_at
  from public.organizations o;

comment on view public.workspaces is
  'Espaços de trabalho de quem consulta: o pessoal e as organizações em que é membro ativo. Só leitura.';

create view public.workspace_members
with (security_invoker = true)
as
  select p.user_id as workspace_id,
         'PERSONAL'::text as workspace_type,
         p.user_id,
         'owner'::text as role_key,
         'active'::text as status,
         p.created_at
  from public.user_preferences p
  union all
  select m.organization_id,
         'BUSINESS'::text,
         m.user_id,
         r.key,
         m.status::text,
         m.created_at
  from public.organization_members m
  join public.roles r on r.id = m.role_id;

comment on view public.workspace_members is
  'Membros dos espaços visíveis a quem consulta. No pessoal, só o próprio como proprietário. Só leitura.';

revoke all on public.workspaces, public.workspace_members from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

-- ---------------------------------------------------------------------------
-- Verificação de acesso (para RPCs das fases seguintes, por exemplo transferências)
-- ---------------------------------------------------------------------------

create or replace function private.can_access_workspace(p_type text, p_id uuid, p_permission text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or p_id is null then false
    -- O espaço pessoal só é acessível ao próprio, com todas as permissões.
    when p_type = 'PERSONAL' then p_id = (select auth.uid())
    when p_type = 'BUSINESS' then
      case when p_permission is null then private.is_org_member(p_id)
           else private.has_org_permission(p_id, p_permission) end
    else false
  end;
$$;

revoke all on function private.can_access_workspace(text, uuid, text) from public, anon;
grant execute on function private.can_access_workspace(text, uuid, text) to authenticated;

-- Exposta para a interface poder confirmar um workspace (a autorização real continua no RLS de cada tabela).
create or replace function public.can_access_workspace(p_type text, p_id uuid, p_permission text default null)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.can_access_workspace(p_type, p_id, p_permission);
$$;

revoke all on function public.can_access_workspace(text, uuid, text) from public, anon;
grant execute on function public.can_access_workspace(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Espaço pessoal garantido (idempotente)
-- ---------------------------------------------------------------------------
-- O registo já o cria (private.handle_new_user). Esta função repõe o perfil e as preferências
-- de uma conta a que faltem (por exemplo, contas anteriores ao gatilho), sem duplicar nem alterar
-- o que existe. Devolve o id do workspace pessoal.
create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_locale text;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  insert into public.users_profiles (id) values (v_user) on conflict (id) do nothing;

  select u.raw_user_meta_data ->> 'locale' into v_locale from auth.users u where u.id = v_user;
  insert into public.user_preferences (user_id, language_code, currency_code, timezone, country_code)
  select v_user,
         coalesce(l.code, 'pt-PT'),
         case when l.code = 'pt-BR' then 'BRL' else 'EUR' end,
         case when l.code = 'pt-BR' then 'America/Sao_Paulo' else 'Europe/Lisbon' end,
         case when l.code = 'pt-BR' then 'BR' else 'PT' end
  from (select 1) as one
  left join public.languages l on l.code = v_locale and l.is_enabled
  on conflict (user_id) do nothing;

  return v_user;
end;
$$;

revoke all on function public.ensure_personal_workspace() from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated;
