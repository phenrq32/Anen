-- Centro de inteligência: resumos da ANEN AI guardados por período.
-- As recomendações são determinísticas e calculadas na aplicação (não se guardam).
-- O resumo escrito pelo modelo guarda-se para não gastar outra pergunta ao voltar à página.
-- Pertence à pessoa (como as conversas): nas organizações, só enquanto for membro ativo.

create table public.ai_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  period_kind text not null check (period_kind in ('week', 'month')),
  period_from date not null,
  period_to date not null,
  content text not null check (char_length(content) between 1 and 20000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  tools text[] not null default '{}' check (cardinality(tools) <= 30),
  model text,
  created_at timestamptz not null default now(),
  constraint ai_digests_period check (period_from <= period_to and period_to - period_from <= 62)
);

-- Um resumo por pessoa, âmbito, tipo e dia final.
create unique index ai_digests_unique_idx on public.ai_digests
  (user_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), period_kind, period_to);
create index ai_digests_org_idx on public.ai_digests (organization_id) where organization_id is not null;

alter table public.ai_digests enable row level security;

create policy "own" on public.ai_digests for all to authenticated
  using (user_id = (select auth.uid()) and (organization_id is null or private.is_org_member(organization_id)))
  with check (user_id = (select auth.uid()) and (organization_id is null or private.is_org_member(organization_id)));

revoke all on public.ai_digests from anon;
revoke truncate, update on public.ai_digests from authenticated;
