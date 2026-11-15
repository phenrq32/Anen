-- ANEN · Fase 1 · Identidade, organizações, RBAC, auditoria e administração
-- Princípios: RLS em todas as tabelas; escrita sensível apenas por funções SECURITY DEFINER
-- que validam permissões; nenhuma confiança em filtros do frontend.

create type public.account_type as enum ('personal', 'independent', 'business', 'client');
create type public.organization_kind as enum ('independent', 'business');
create type public.member_status as enum ('active', 'suspended');

-- ---------------------------------------------------------------------------
-- Validação de números fiscais (defesa em profundidade: o servidor web também valida)
-- PT: NIF/NIPC módulo 11 · BR: CPF e CNPJ (incluindo alfanumérico, IN RFB 2.229/2024)
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_tax_id(p_country text, p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p_value, ''), '[[:space:]./-]', '', 'g'));
  total integer;
  r integer;
  w integer;
  d1 integer;
  d2 integer;
  vals integer[];
begin
  if p_country = 'PT' then
    if v !~ '^[0-9]{9}$' then return false; end if;
    if v !~ '^(1|2|3|5|6|8|45|70|71|72|74|75|77|79|90|91|98|99)' then return false; end if;
    total := 0;
    for i in 1..8 loop
      total := total + substr(v, i, 1)::integer * (10 - i);
    end loop;
    r := total % 11;
    return (case when r < 2 then 0 else 11 - r end) = substr(v, 9, 1)::integer;
  elsif p_country = 'BR' then
    if v ~ '^[0-9]{11}$' then
      if v ~ '^(.)\1{10}$' then return false; end if;
      total := 0;
      for i in 1..9 loop total := total + substr(v, i, 1)::integer * (11 - i); end loop;
      d1 := ((total * 10) % 11) % 10;
      total := 0;
      for i in 1..10 loop total := total + substr(v, i, 1)::integer * (12 - i); end loop;
      d2 := ((total * 10) % 11) % 10;
      return d1 = substr(v, 10, 1)::integer and d2 = substr(v, 11, 1)::integer;
    elsif v ~ '^[0-9A-Z]{12}[0-9]{2}$' then
      if v ~ '^(.)\1{13}$' then return false; end if;
      vals := array(select ascii(substr(v, g, 1)) - 48 from generate_series(1, 14) as g);
      total := 0; w := 2;
      for i in reverse 12..1 loop
        total := total + vals[i] * w;
        w := case when w = 9 then 2 else w + 1 end;
      end loop;
      r := total % 11; d1 := case when r < 2 then 0 else 11 - r end;
      total := 0; w := 2;
      for i in reverse 13..1 loop
        total := total + vals[i] * w;
        w := case when w = 9 then 2 else w + 1 end;
      end loop;
      r := total % 11; d2 := case when r < 2 then 0 else 11 - r end;
      return d1 = vals[13] and d2 = vals[14];
    end if;
    return false;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfis e preferências
-- ---------------------------------------------------------------------------

create table public.users_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  avatar_path text check (char_length(avatar_path) <= 300),
  primary_account_type public.account_type,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  country_code char(2) references public.countries (code),
  language_code text not null default 'pt-PT' references public.languages (code),
  currency_code char(3) not null default 'EUR' references public.currencies (code),
  timezone text not null default 'Europe/Lisbon',
  active_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Organizações e RBAC
-- ---------------------------------------------------------------------------

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  kind public.organization_kind not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name text check (char_length(legal_name) <= 200),
  tax_id text check (tax_id ~ '^[0-9A-Z]{1,32}$'),
  country_code char(2) not null references public.countries (code),
  region_id uuid references public.regions (id),
  currency_code char(3) not null references public.currencies (code),
  timezone text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_tax_id_valid check (tax_id is null or private.is_valid_tax_id(country_code, tax_id))
);
create index organizations_created_by_idx on public.organizations (created_by);
-- Sem unicidade: impedir que alguém "ocupe" o número fiscal de outra empresa. A verificação de titularidade vem depois.
create index organizations_tax_id_idx on public.organizations (country_code, tax_id) where tax_id is not null;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 200),
  is_system boolean not null default false,
  rank smallint not null check (rank between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_scope check ((is_system and organization_id is null) or (not is_system and organization_id is not null))
);
create unique index roles_system_key_idx on public.roles (key) where organization_id is null;
create unique index roles_org_key_idx on public.roles (organization_id, key) where organization_id is not null;

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  status public.member_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_role_idx on public.organization_members (role_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_id uuid not null references public.roles (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_invitations_pending_idx
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invitations_role_idx on public.organization_invitations (role_id);

alter table public.user_preferences
  add constraint user_preferences_active_org_fk
  foreign key (active_organization_id) references public.organizations (id) on delete set null;
create index user_preferences_active_org_idx on public.user_preferences (active_organization_id);

-- ---------------------------------------------------------------------------
-- Auditoria e administração da plataforma
-- ---------------------------------------------------------------------------

-- Sem FK para organizations: o registo tem de sobreviver à eliminação da organização.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'support', 'finance', 'content')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  description text not null,
  is_enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value jsonb not null,
  is_public boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER evita recursão de RLS em organization_members)
-- ---------------------------------------------------------------------------

create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function private.has_org_permission(p_org uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and rp.permission_key = p_permission
  );
$$;

-- Nível hierárquico de um membro ativo (−1 se não for membro ativo).
create or replace function private.member_rank(p_org uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.rank::integer
    from public.organization_members m
    join public.roles r on r.id = m.role_id
    where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
  ), -1);
$$;

create or replace function private.shares_organization(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = p_user
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()));
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_permission(uuid, text) to authenticated;
grant execute on function private.member_rank(uuid, uuid) to authenticated;
grant execute on function private.shares_organization(uuid) to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_valid_tax_id(text, text) to authenticated, service_role;
grant execute on function private.assert_valid_timezone(text) to authenticated, service_role;
grant execute on function private.set_updated_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger users_profiles_updated_at before update on public.users_profiles
  for each row execute function private.set_updated_at();
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function private.set_updated_at();
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function private.set_updated_at();
create trigger feature_flags_updated_at before update on public.feature_flags
  for each row execute function private.set_updated_at();

-- Perfil e preferências criados automaticamente no registo.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.users_profiles (id, full_name)
  values (new.id, left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120));

  insert into public.user_preferences (user_id, language_code, currency_code, timezone, country_code)
  select new.id,
         coalesce(l.code, 'pt-PT'),
         case when l.code = 'pt-BR' then 'BRL' else 'EUR' end,
         case when l.code = 'pt-BR' then 'America/Sao_Paulo' else 'Europe/Lisbon' end,
         case when l.code = 'pt-BR' then 'BR' else 'PT' end
  from (select 1) as one
  left join public.languages l on l.code = v_locale and l.is_enabled;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.validate_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_valid_timezone(new.timezone);
  if new.country_code is not null
     and not exists (select 1 from public.countries c where c.code = new.country_code and c.is_supported) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  if not exists (select 1 from public.languages l where l.code = new.language_code and l.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  if not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  if new.active_organization_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.active_organization_id and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger user_preferences_validate before insert or update on public.user_preferences
  for each row execute function private.validate_user_preferences();

create or replace function private.validate_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_valid_timezone(new.timezone);
  if not exists (select 1 from public.countries c where c.code = new.country_code and c.is_supported)
     or not exists (select 1 from public.currencies c where c.code = new.currency_code and c.is_enabled) then
    raise exception 'unsupported_reference' using errcode = '22023';
  end if;
  if new.region_id is not null and not exists (
    select 1 from public.regions r where r.id = new.region_id and r.country_code = new.country_code
  ) then
    raise exception 'region_country_mismatch' using errcode = '22023';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

create trigger organizations_validate before insert or update on public.organizations
  for each row execute function private.validate_organization();

-- O papel atribuído tem de ser de sistema ou pertencer à mesma organização.
create or replace function private.validate_role_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.roles r
    where r.id = new.role_id and (r.organization_id is null or r.organization_id = new.organization_id)
  ) then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger organization_members_role_scope before insert or update of role_id on public.organization_members
  for each row execute function private.validate_role_scope();
create trigger organization_invitations_role_scope before insert or update of role_id on public.organization_invitations
  for each row execute function private.validate_role_scope();

-- Auditoria genérica de alterações sensíveis.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_org uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old) - 'token_hash';
  else
    v_row := to_jsonb(new) - 'token_hash';
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'token_hash';
  end if;

  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif tg_table_name = 'role_permissions' then
    select r.organization_id into v_org from public.roles r where r.id = (v_row ->> 'role_id')::uuid;
  else
    v_org := nullif(v_row ->> 'organization_id', '')::uuid;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'role_id'),
    jsonb_strip_nulls(jsonb_build_object(
      'new', case when tg_op <> 'DELETE' then v_row end,
      'old', case when tg_op = 'UPDATE' then v_old when tg_op = 'DELETE' then v_row end
    ))
  );
  return null;
end;
$$;

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change();
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function private.audit_row_change();
create trigger organization_invitations_audit after insert or update on public.organization_invitations
  for each row execute function private.audit_row_change();
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function private.audit_row_change();
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function private.audit_row_change();
create trigger admin_users_audit after insert or update or delete on public.admin_users
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.users_profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.permissions enable row level security;
alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_users enable row level security;
alter table public.feature_flags enable row level security;
alter table public.system_settings enable row level security;

-- Perfis: o próprio e quem partilha uma organização (para listas de membros).
create policy "profiles readable by self and co-members" on public.users_profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_organization(id));
create policy "profiles updatable by self" on public.users_profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "preferences readable by self" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "preferences updatable by self" on public.user_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "permissions catalog readable" on public.permissions
  for select to authenticated using (true);

create policy "organizations readable by members" on public.organizations
  for select to authenticated using (private.is_org_member(id));
create policy "organizations updatable with permission" on public.organizations
  for update to authenticated
  using (private.has_org_permission(id, 'organization.update'))
  with check (private.has_org_permission(id, 'organization.update'));
create policy "organizations deletable with permission" on public.organizations
  for delete to authenticated using (private.has_org_permission(id, 'organization.delete'));

create policy "roles readable" on public.roles
  for select to authenticated
  using (organization_id is null or private.is_org_member(organization_id));

create policy "role permissions readable" on public.role_permissions
  for select to authenticated
  using (exists (
    select 1 from public.roles r
    where r.id = role_id and (r.organization_id is null or private.is_org_member(r.organization_id))
  ));

create policy "members readable by co-members" on public.organization_members
  for select to authenticated using (private.is_org_member(organization_id));

create policy "invitations readable by inviters" on public.organization_invitations
  for select to authenticated
  using (
    private.has_org_permission(organization_id, 'members.invite')
    or private.has_org_permission(organization_id, 'members.manage')
  );

create policy "audit readable with permission" on public.audit_logs
  for select to authenticated using (private.has_org_permission(organization_id, 'audit.read'));

create policy "admin row readable by self" on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

create policy "feature flags readable" on public.feature_flags
  for select to authenticated using (true);

create policy "public settings readable" on public.system_settings
  for select to anon, authenticated using (is_public);

-- ---------------------------------------------------------------------------
-- Privilégios: o Supabase concede tudo por omissão a anon/authenticated; restringimos.
-- Escritas em membros, funções, convites e auditoria só via funções RPC.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.languages, public.currencies, public.countries, public.regions,
  public.permissions, public.roles, public.role_permissions, public.organization_members,
  public.organization_invitations, public.audit_logs, public.admin_users, public.feature_flags,
  public.system_settings
  from anon, authenticated;

revoke all on public.users_profiles, public.user_preferences, public.organizations,
  public.organization_members, public.organization_invitations, public.roles, public.role_permissions,
  public.audit_logs, public.admin_users, public.feature_flags, public.permissions
  from anon;

revoke insert, update, delete, truncate on public.users_profiles from authenticated;
grant update (full_name, avatar_path, primary_account_type, onboarded_at) on public.users_profiles to authenticated;

revoke insert, update, delete, truncate on public.user_preferences from authenticated;
grant update (country_code, language_code, currency_code, timezone, active_organization_id)
  on public.user_preferences to authenticated;

revoke insert, update, truncate on public.organizations from authenticated;
grant update (name, legal_name, tax_id, region_id, currency_code, timezone) on public.organizations to authenticated;

-- token_hash nunca é legível pelos clientes.
revoke select on public.organization_invitations from authenticated;
grant select (id, organization_id, email, role_id, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  on public.organization_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo de permissões e funções de sistema
-- ---------------------------------------------------------------------------

insert into public.permissions (key, module, description) values
  ('organization.update', 'organization', 'Editar dados da organização'),
  ('organization.delete', 'organization', 'Eliminar a organização'),
  ('members.invite', 'members', 'Convidar membros'),
  ('members.manage', 'members', 'Alterar funções, suspender e remover membros'),
  ('roles.manage', 'roles', 'Criar e editar funções personalizadas'),
  ('audit.read', 'audit', 'Consultar o registo de auditoria');

insert into public.roles (key, name, description, is_system, rank) values
  ('owner', 'Proprietário', 'Controlo total, incluindo eliminar a organização.', true, 100),
  ('admin', 'Administrador', 'Gere a organização, a equipa e as funções.', true, 80),
  ('manager', 'Gestor', 'Coordena a equipa e convida membros.', true, 60),
  ('accountant', 'Contabilista', 'Acesso financeiro e fiscal (módulos seguintes).', true, 40),
  ('employee', 'Funcionário', 'Trabalho operacional (módulos seguintes).', true, 30),
  ('viewer', 'Leitor', 'Apenas consulta.', true, 10);

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.organization_id is null and (
  r.key = 'owner'
  or (r.key = 'admin' and p.key <> 'organization.delete')
  or (r.key = 'manager' and p.key = 'members.invite')
  or (r.key = 'accountant' and p.key = 'audit.read')
);

insert into public.feature_flags (key, description, is_enabled) values
  ('auth.google', 'Login com Google (requer provider configurado no Supabase)', false),
  ('invitations.email_delivery', 'Envio automático de convites por email (requer fornecedor de email)', false);
