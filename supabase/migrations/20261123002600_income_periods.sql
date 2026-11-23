-- Receitas (ou despesas) de um período: "recebi 850 € esta semana", sem ter de registar cada recebimento.
-- O movimento continua a ter uma data (occurred_on, dentro do período, para os relatórios por mês) e passa a
-- poder indicar o período a que respeita (dia, semana ou mês).

alter table public.transactions
  add column period_start date,
  add column period_end date,
  add constraint transactions_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_start <= period_end
        and period_end - period_start <= 31 and occurred_on between period_start and period_end)
  );

grant update (period_start, period_end) on public.transactions to authenticated;
