-- Apagar a própria conta (RGPD/LGPD, direito ao apagamento) e apagar uma organização.
--
-- Apagar a conta: dados pessoais apagados em cascata; dados das organizações ficam (autor passa a NULL,
-- migration 0600). Uma organização em que a pessoa é a ÚNICA proprietária:
--   • se tem outros membros ativos → recusa ('owner_must_transfer'): primeiro passar a propriedade a alguém;
--   • se a pessoa está sozinha → a organização é apagada junto (ninguém mais a podia gerir).
-- Confirmação: o email da conta, escrito pela pessoa.
--
-- Apagar uma organização: só proprietários ativos, confirmando o nome exato. Tudo o que é dela é apagado em
-- cascata (finanças, orçamentos, stock, faturação guardada…). Os documentos já emitidos no InvoiceXpress
-- continuam lá (o software certificado guarda-os); aqui só desaparece a cópia de consulta.

create or replace function public.delete_my_account(p_confirm_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_email text;
  v_org record;
begin
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null or lower(btrim(coalesce(p_confirm_email, ''))) <> lower(v_email) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  for v_org in
    select m.organization_id,
           exists (select 1 from public.organization_members o
                   where o.organization_id = m.organization_id and o.user_id <> v_uid and o.status = 'active') as has_others,
           (r.key = 'owner' and r.organization_id is null) as is_owner
    from public.organization_members m
    join public.roles r on r.id = m.role_id
    where m.user_id = v_uid and m.status = 'active'
    for update of m
  loop
    if v_org.is_owner and private.active_owner_count(v_org.organization_id, (
         select id from public.organization_members where organization_id = v_org.organization_id and user_id = v_uid)) = 0 then
      if v_org.has_others then
        raise exception 'owner_must_transfer' using errcode = '23514';
      end if;
      delete from public.organizations where id = v_org.organization_id;
    end if;
  end loop;

  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

create or replace function public.delete_organization(p_org uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_name text;
begin
  select o.name into v_name from public.organizations o where o.id = p_org for update;
  if not found or not exists (
    select 1 from public.organization_members m
    join public.roles r on r.id = m.role_id
    where m.organization_id = p_org and m.user_id = v_uid and m.status = 'active'
      and r.key = 'owner' and r.organization_id is null
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_name) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;
  delete from public.organizations where id = p_org;
end;
$$;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.delete_organization(uuid, text) to authenticated;

-- Notificações apagadas pela pessoa: ficam marcadas (dismissed_at) em vez de sair da tabela, para a tarefa diária
-- não as voltar a criar (a chave dedupe_key continua ocupada). Não aparecem nem contam como por ler.
alter table public.notifications add column dismissed_at timestamptz;
grant update (dismissed_at) on public.notifications to authenticated;
create index notifications_visible_unread_idx on public.notifications (user_id) where read_at is null and dismissed_at is null;
