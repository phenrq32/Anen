-- Dual Workspace · Fase 4: convites pendentes no seletor de contexto.
-- A pessoa convidada vê os convites dirigidos ao email confirmado da sua conta e aceita-os sem o link.
-- As regras são as de accept_invitation(token): email confirmado igual ao convidado, convite não aceite,
-- não revogado e não expirado, e ainda não membro. O token do link só prova que a pessoa recebeu o email;
-- um email confirmado na conta prova o mesmo.
-- Reversão: drop function public.my_invitations(), public.accept_my_invitation(uuid);

create or replace function public.my_invitations()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  role_key text,
  role_name text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, o.id, o.name, r.key, r.name, i.expires_at, i.created_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id
  join auth.users u on u.id = (select auth.uid()) and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and not exists (
      select 1 from public.organization_members m where m.organization_id = i.organization_id and m.user_id = u.id
    )
  order by i.created_at desc;
$$;

create or replace function public.accept_my_invitation(p_invitation_id uuid)
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
  where i.id = p_invitation_id
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update;
  if not found then
    raise exception 'invitation_invalid' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email <> v_inv.email then
    -- Mesmo erro que um id inexistente: não revela que o convite existe para outra pessoa.
    raise exception 'invitation_invalid' using errcode = '22023';
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

revoke all on function public.my_invitations() from public, anon;
revoke all on function public.accept_my_invitation(uuid) from public, anon;
grant execute on function public.my_invitations() to authenticated;
grant execute on function public.accept_my_invitation(uuid) to authenticated;
