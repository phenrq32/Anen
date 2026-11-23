-- Dual Workspace · Fase 3: o workspace de um registo nunca muda numa edição, e mais operações auditadas.
--
-- Contexto: budgets, financial_accounts, fiscal_documents, fixed_expenses, monthly_plans, recipes e
-- savings_goals dão UPDATE à tabela inteira (incluindo organization_id/owner_user_id). Na verificação da
-- Fase 3 confirmou-se que NÃO havia falha: os gatilhos de cada uma já recusam mudar o âmbito ('forbidden'),
-- e as restantes tabelas não dão UPDATE nessas colunas. A proteção estava, porém, espalhada por gatilhos
-- diferentes e dependia de cada tabela nova se lembrar dela.
--
-- Esta migration acrescenta uma regra única e uniforme: um gatilho BEFORE UPDATE em todas as tabelas com
-- âmbito recusa mudar organization_id ou owner_user_id (erro workspace_immutable), para qualquer papel,
-- incluindo funções SECURITY DEFINER. packages/database/tests/isolation.test.ts exige-o em todas as tabelas,
-- incluindo as futuras. Nenhuma função da aplicação move registos entre workspaces, e as FKs de âmbito são
-- todas "on delete cascade".
--
-- Reversão: drop trigger workspace_immutable on <cada tabela>; drop function private.prevent_workspace_change();
--           drop trigger <tabela>_audit nas quatro tabelas auditadas abaixo.

create or replace function private.prevent_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
begin
  if (v_new ->> 'organization_id') is distinct from (v_old ->> 'organization_id')
     or (v_new ->> 'owner_user_id') is distinct from (v_old ->> 'owner_user_id') then
    raise exception 'workspace_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_workspace_change() from public, anon;

-- Todas as tabelas públicas com organization_id ou owner_user_id, exceto o registo de auditoria (só inserções).
do $$
declare
  r record;
begin
  for r in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in ('organization_id', 'owner_user_id')
      and c.table_name <> 'audit_logs'
  loop
    execute format('drop trigger if exists workspace_immutable on public.%I', r.table_name);
    execute format(
      'create trigger workspace_immutable before update on public.%I for each row execute function private.prevent_workspace_change()',
      r.table_name
    );
  end loop;
end;
$$;

-- Operações sensíveis ainda sem auditoria: recorrências (geram movimentos), anexos (comprovativos),
-- orçamentos mensais e objetivos.
create trigger recurring_transactions_audit after insert or update or delete on public.recurring_transactions
  for each row execute function private.audit_row_change();
create trigger transaction_attachments_audit after insert or update or delete on public.transaction_attachments
  for each row execute function private.audit_row_change();
create trigger budgets_audit after insert or update or delete on public.budgets
  for each row execute function private.audit_row_change();
create trigger savings_goals_audit after insert or update or delete on public.savings_goals
  for each row execute function private.audit_row_change();
