-- Importação de extratos bancários (CSV/OFX).
-- import_ref identifica a linha do extrato: o FITID do OFX ou, no CSV, uma impressão digital
-- (data|valor|descrição|n.º de ocorrência). Único por conta: importar o mesmo extrato duas vezes não duplica.
-- Só se define ao criar (o cliente não o altera depois; não há permissão de update na coluna).

alter table public.transactions
  add column import_ref text check (char_length(import_ref) between 1 and 200);
-- Índice completo (não parcial): os NULL contam como distintos e o PostgREST consegue usá-lo em on_conflict.
create unique index transactions_import_ref_idx on public.transactions (account_id, import_ref);
