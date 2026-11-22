-- Áreas do menu que cada pessoa escolhe esconder (Definições → Áreas do menu). Só muda o menu e a procura:
-- as páginas continuam a existir e os dados não são tocados.
--
-- Por omissão, as fichas técnicas (restauração) ficam escondidas: só interessam a quem trabalha com comida.
-- Quem já tem fichas técnicas (no pessoal ou numa organização de que é membro) continua a vê-las.

alter table public.user_preferences
  add column hidden_modules text[] not null default array['restauracao']::text[]
    check (hidden_modules <@ array['orcamentos', 'faturacao', 'projetos', 'compras', 'inventario', 'restauracao',
                                   'ia', 'inteligencia', 'relatorios', 'mercado']::text[]
           and cardinality(hidden_modules) <= 10);

update public.user_preferences up
set hidden_modules = '{}'
where exists (select 1 from public.recipes r where r.owner_user_id = up.user_id)
   or exists (
     select 1 from public.recipes r
     join public.organization_members om on om.organization_id = r.organization_id
     where om.user_id = up.user_id and om.status = 'active'
   );

grant update (hidden_modules) on public.user_preferences to authenticated;
