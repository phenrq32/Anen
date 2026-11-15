-- ANEN · Fase 1 · Operações de organização (RPC)
-- Todas as funções validam autenticação, permissão e hierarquia no servidor.
-- As mensagens de erro são chaves de tradução (@anen/i18n → errors.*).

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Pode atribuir uma função de nível p_rank? Proprietários podem tudo; os restantes só abaixo do próprio nível.
create or replace function private.can_assign_rank(p_org uuid, p_user uuid, p_rank integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.member_rank(p_org, p_user) = 100 then true
    else private.member_rank(p_org, p_user) > p_rank
  end;
$$;

create or replace function private.normalize_tax_id(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[[:space:]./-]', '', 'g')), '');
$$;

revoke all on function private.require_user() from public;
revoke all on function private.can_assign_rank(uuid, uuid, integer) from public;
revoke all on function private.normalize_tax_id(text) from public;

-- ---------------------------------------------------------------------------
-- Criar organização (o criador fica proprietário e a organização passa a ser o contexto ativo)
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  p_kind public.organization_kind,
  p_name text,
  p_country_code text,
  p_currency_code text,
  p_timezone text,
  p_legal_name text default null,
  p_tax_id text default null,
  p_region_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_org uuid;
  v_owner_role uuid;
  v_limit integer;
  v_constraint text;
begin
  -- Limite provisório anti-abuso; os limites por plano (Free/Pro/Max) chegam na Fase 8.
  select coalesce((value ->> 'max')::integer, 10) into v_limit
  from public.system_settings where key = 'limits.organizations_per_user';
  v_limit := coalesce(v_limit, 10);
  if (select count(*) from public.organizations o where o.created_by = v_uid) >= v_limit then
    raise exception 'organization_limit' using errcode = '54000';
  end if;

  insert into public.organizations (kind, name, legal_name, tax_id, country_code, region_id, currency_code, timezone, created_by)
  values (
    p_kind,
    p_name,
    nullif(btrim(p_legal_name), ''),
    private.normalize_tax_id(p_tax_id),
    p_country_code,
    p_region_id,
    p_currency_code,
    p_timezone,
    v_uid
  )
  returning id into v_org;

  select id into v_owner_role from public.roles where organization_id is null and key = 'owner';
  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (v_org, v_uid, v_owner_role, 'active');

  update public.user_preferences set active_organization_id = v_org where user_id = v_uid;
  return v_org;
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint in ('organizations_tax_id_valid', 'organizations_tax_id_check') then
      raise exception 'tax_id_invalid' using errcode = '22023';
    elsif v_constraint = 'organizations_name_check' then
      raise exception 'name_required' using errcode = '22023';
    end if;
    raise exception 'too_long' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create or replace function public.invite_member(p_organization_id uuid, p_email text, p_role_id uuid)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_email text := lower(btrim(p_email));
  v_role public.roles%rowtype;
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if not private.has_org_permission(p_organization_id, 'members.invite') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_role from public.roles r
  where r.id = p_role_id and (r.organization_id is null or r.organization_id = p_organization_id);
  if not found then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if not private.can_assign_rank(p_organization_id, v_uid, v_role.rank) then
    raise exception 'rank_violation' using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'email_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  -- Convites expirados deixam de bloquear um novo convite.
  update public.organization_invitations i
  set revoked_at = now()
  where i.organization_id = p_organization_id and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();

  if exists (
    select 1 from public.organization_invitations i
    where i.organization_id = p_organization_id and i.email = v_email
      and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'invitation_pending' using errcode = '23505';
  end if;

  -- 256 bits aleatórios (dois UUID v4, gerador criptográfico). Só o hash fica guardado.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.organization_invitations (organization_id, email, role_id, token_hash, invited_by, expires_at)
  values (p_organization_id, v_email, p_role_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid, v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

-- Pré-visualização de um convite a partir do token (disponível antes de iniciar sessão).
create or replace function public.get_invitation(p_token text)
returns table (organization_name text, role_key text, role_name text, email text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, r.key, r.name, i.email, i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.organization_invitations%rowtype;
  v_email text;
begin
  select * into v_inv from public.organization_invitations i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update;
  if not found then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email <> v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;

  if exists (select 1 from public.organization_members m where m.organization_id = v_inv.organization_id and m.user_id = v_uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.organization_members (organization_id, user_id, role_id, status, invited_by)
  values (v_inv.organization_id, v_uid, v_inv.role_id, 'active', v_inv.invited_by);

  update public.organization_invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  update public.user_preferences set active_organization_id = v_inv.organization_id where user_id = v_uid;
  return v_inv.organization_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.organization_invitations%rowtype;
  v_rank integer;
begin
  select * into v_inv from public.organization_invitations where id = p_invitation_id for update;
  if not found or not (
    private.has_org_permission(v_inv.organization_id, 'members.invite')
    or private.has_org_permission(v_inv.organization_id, 'members.manage')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select r.rank into v_rank from public.roles r where r.id = v_inv.role_id;
  if v_inv.invited_by is distinct from v_uid and not private.can_assign_rank(v_inv.organization_id, v_uid, v_rank) then
    raise exception 'rank_violation' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;
  update public.organization_invitations set revoked_at = now() where id = p_invitation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membros
-- ---------------------------------------------------------------------------
create or replace function private.active_owner_count(p_org uuid, p_except_member uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.organization_members m join public.roles r on r.id = m.role_id
  where m.organization_id = p_org and m.status = 'active' and r.key = 'owner' and r.organization_id is null
    and m.id <> coalesce(p_except_member, '00000000-0000-0000-0000-000000000000'::uuid);
$$;
revoke all on function private.active_owner_count(uuid, uuid) from public;

create or replace function public.update_member(p_member_id uuid, p_role_id uuid, p_status public.member_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_member public.organization_members%rowtype;
  v_current_rank integer;
  v_current_is_owner boolean;
  v_new public.roles%rowtype;
begin
  select * into v_member from public.organization_members where id = p_member_id for update;
  if not found or not private.has_org_permission(v_member.organization_id, 'members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_member.user_id = v_uid then
    -- Evita auto-promoção ou bloqueio acidental; alterar a própria função exige outro gestor.
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select r.rank, (r.key = 'owner' and r.organization_id is null)
  into v_current_rank, v_current_is_owner
  from public.roles r where r.id = v_member.role_id;
  if not private.can_assign_rank(v_member.organization_id, v_uid, v_current_rank) then
    raise exception 'rank_violation' using errcode = '42501';
  end if;

  select * into v_new from public.roles r
  where r.id = p_role_id and (r.organization_id is null or r.organization_id = v_member.organization_id);
  if not found then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if not private.can_assign_rank(v_member.organization_id, v_uid, v_new.rank) then
    raise exception 'rank_violation' using errcode = '42501';
  end if;

  if v_current_is_owner and (v_new.key <> 'owner' or p_status <> 'active')
     and private.active_owner_count(v_member.organization_id, v_member.id) = 0 then
    raise exception 'last_owner' using errcode = '23514';
  end if;

  update public.organization_members set role_id = p_role_id, status = p_status where id = p_member_id;
  if p_status <> 'active' then
    update public.user_preferences set active_organization_id = null
    where user_id = v_member.user_id and active_organization_id = v_member.organization_id;
  end if;
end;
$$;

create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_member public.organization_members%rowtype;
  v_rank integer;
  v_is_owner boolean;
begin
  select * into v_member from public.organization_members where id = p_member_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select r.rank, (r.key = 'owner' and r.organization_id is null) into v_rank, v_is_owner
  from public.roles r where r.id = v_member.role_id;

  if v_member.user_id <> v_uid then
    if not private.has_org_permission(v_member.organization_id, 'members.manage') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not private.can_assign_rank(v_member.organization_id, v_uid, v_rank) then
      raise exception 'rank_violation' using errcode = '42501';
    end if;
  end if;

  if v_is_owner and private.active_owner_count(v_member.organization_id, v_member.id) = 0 then
    raise exception 'last_owner' using errcode = '23514';
  end if;

  update public.user_preferences set active_organization_id = null
  where user_id = v_member.user_id and active_organization_id = v_member.organization_id;
  delete from public.organization_members where id = p_member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funções personalizadas
-- ---------------------------------------------------------------------------
create or replace function public.upsert_role(
  p_organization_id uuid,
  p_name text,
  p_permissions text[],
  p_description text default null,
  p_role_id uuid default null,
  p_rank integer default 20
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_actor_rank integer;
  v_role public.roles%rowtype;
  v_id uuid;
  v_missing text;
begin
  if not private.has_org_permission(p_organization_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor_rank := private.member_rank(p_organization_id, v_uid);
  if p_rank is null or p_rank < 1 or p_rank >= v_actor_rank or p_rank >= 100 then
    raise exception 'rank_violation' using errcode = '42501';
  end if;

  -- Não é possível conceder permissões que o próprio não tem.
  select k into v_missing
  from unnest(coalesce(p_permissions, '{}'::text[])) as k
  where not private.has_org_permission(p_organization_id, k)
  limit 1;
  if v_missing is not null then
    raise exception 'permission_not_held' using errcode = '42501';
  end if;

  if p_role_id is null then
    insert into public.roles (organization_id, key, name, description, is_system, rank)
    values (
      p_organization_id,
      'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      btrim(p_name),
      nullif(btrim(p_description), ''),
      false,
      p_rank
    )
    returning id into v_id;
  else
    select * into v_role from public.roles where id = p_role_id for update;
    if not found or v_role.organization_id is distinct from p_organization_id or v_role.is_system then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_role.rank >= v_actor_rank then
      raise exception 'rank_violation' using errcode = '42501';
    end if;
    update public.roles
    set name = btrim(p_name), description = nullif(btrim(p_description), ''), rank = p_rank
    where id = p_role_id;
    v_id := p_role_id;
    delete from public.role_permissions where role_id = v_id
      and permission_key <> all (coalesce(p_permissions, '{}'::text[]));
  end if;

  insert into public.role_permissions (role_id, permission_key)
  select v_id, k from unnest(coalesce(p_permissions, '{}'::text[])) as k
  on conflict do nothing;
  return v_id;
exception
  when foreign_key_violation then
    raise exception 'permission_not_held' using errcode = '22023';
  when check_violation then
    raise exception 'name_required' using errcode = '22023';
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_role public.roles%rowtype;
begin
  select * into v_role from public.roles where id = p_role_id for update;
  if not found or v_role.is_system or not private.has_org_permission(v_role.organization_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role.rank >= private.member_rank(v_role.organization_id, v_uid) then
    raise exception 'rank_violation' using errcode = '42501';
  end if;
  if exists (select 1 from public.organization_members where role_id = p_role_id)
     or exists (select 1 from public.organization_invitations where role_id = p_role_id and accepted_at is null and revoked_at is null) then
    raise exception 'role_in_use' using errcode = '23503';
  end if;
  delete from public.roles where id = p_role_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilégios das RPC
-- ---------------------------------------------------------------------------
revoke all on function public.create_organization(public.organization_kind, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.invite_member(uuid, text, uuid) from public, anon;
revoke all on function public.get_invitation(text) from public;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.update_member(uuid, uuid, public.member_status) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.upsert_role(uuid, text, text[], text, uuid, integer) from public, anon;
revoke all on function public.delete_role(uuid) from public, anon;

grant execute on function public.create_organization(public.organization_kind, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.invite_member(uuid, text, uuid) to authenticated;
grant execute on function public.get_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.update_member(uuid, uuid, public.member_status) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.upsert_role(uuid, text, text[], text, uuid, integer) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;

insert into public.system_settings (key, value, is_public, description) values
  ('limits.organizations_per_user', '{"max": 10}'::jsonb, false, 'Limite provisório de organizações criadas por utilizador (até existirem planos).');
