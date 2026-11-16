-- ANEN · Prompt 03 · Fase 1 · Tarefas no servidor
-- Até aqui os movimentos recorrentes só eram gerados quando alguém abria Finanças.
-- Passam a ser gerados todos os dias no servidor (pg_cron), para todas as pessoas e
-- organizações, com registo de cada execução (início, fim, quantidade e erros).

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (char_length(job) between 1 and 80),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'error')),
  processed integer not null default 0,
  failed integer not null default 0,
  details jsonb not null default '{}'::jsonb
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
create policy "platform admins read" on public.job_runs for select to authenticated using (private.is_platform_admin());
revoke all on public.job_runs from anon;
revoke insert, update, delete, truncate on public.job_runs from authenticated;

-- Gera os recorrentes vencidos de TODOS os âmbitos até p_until. Cada recorrência é isolada:
-- uma falha (ex.: conta arquivada) fica registada e não impede as restantes.
create or replace function private.materialize_all_recurring(p_until date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurring_transactions%rowtype;
  v_created integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_guard integer;
  v_step interval;
begin
  for r in
    select * from public.recurring_transactions rt
    where rt.is_active and rt.next_run_on <= p_until
    order by rt.next_run_on
    for update skip locked
  loop
    begin
      v_guard := 0;
      v_step := case r.frequency
        when 'weekly' then make_interval(weeks => r.interval_count)
        when 'monthly' then make_interval(months => r.interval_count)
        else make_interval(years => r.interval_count) end;
      while r.next_run_on <= p_until and (r.end_on is null or r.next_run_on <= r.end_on) and v_guard < 1000 loop
        insert into public.transactions (organization_id, owner_user_id, account_id, category_id, kind, amount_minor, currency_code,
                                         occurred_on, description, counterparty, recurring_id, created_by)
        values (r.organization_id, r.owner_user_id, r.account_id, r.category_id, r.kind, r.amount_minor, r.currency_code,
                r.next_run_on, r.description, r.counterparty, r.id, r.created_by)
        on conflict do nothing;
        if found then v_created := v_created + 1; end if;
        r.occurrence_count := r.occurrence_count + 1;
        r.next_run_on := (r.start_on + v_step * r.occurrence_count)::date;
        v_guard := v_guard + 1;
      end loop;
      update public.recurring_transactions
      set next_run_on = r.next_run_on,
          occurrence_count = r.occurrence_count,
          is_active = (r.end_on is null or r.next_run_on <= r.end_on)
      where id = r.id;
    exception when others then
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('recurring_id', r.id, 'error', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'failed', v_failed, 'errors', v_errors);
end;
$$;

-- Ponto de entrada diário: corre cada tarefa e regista o resultado.
create or replace function private.run_daily_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_result jsonb;
begin
  insert into public.job_runs (job) values ('materialize_recurring') returning id into v_run;
  begin
    v_result := private.materialize_all_recurring(current_date);
    update public.job_runs set
      finished_at = now(),
      processed = (v_result ->> 'created')::integer,
      failed = (v_result ->> 'failed')::integer,
      status = case when (v_result ->> 'failed')::integer > 0 then 'partial' else 'success' end,
      details = v_result
    where id = v_run;
  exception when others then
    update public.job_runs set finished_at = now(), status = 'error', details = jsonb_build_object('error', sqlerrm) where id = v_run;
  end;
end;
$$;

revoke all on function private.materialize_all_recurring(date) from public;
revoke all on function private.run_daily_jobs() from public;

-- Agendamento diário às 05:00 UTC (madrugada em Portugal e no Brasil).
-- Só quando o pg_cron existe (produção Supabase); nos testes locais a função é chamada diretamente.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('anen-daily-jobs', '0 5 * * *', 'select private.run_daily_jobs()');
  end if;
end;
$$;
