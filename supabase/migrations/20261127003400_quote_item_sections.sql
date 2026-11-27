-- Secções nas linhas do orçamento: agrupar as linhas por serviço ("Pintura de T2 completo" → Tinta, Fita e lixas,
-- Deslocação…) no editor, no documento para o cliente e no PDF. Opcional: linhas sem secção aparecem como antes.
-- Aprovado pelo dono da app a 24/11/2026. Não altera nem apaga dados existentes.
-- Reversão: recriar save_quote_content da migration 20261121001200; alter table public.quote_items drop column section;

alter table public.quote_items
  add column section text check (section is null or char_length(btrim(section)) between 1 and 160);

create or replace function public.save_quote_content(p_quote_id uuid, p_fields jsonb, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.quotes set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    client_contact_id = nullif(p_fields ->> 'client_contact_id', '')::uuid,
    client_name = p_fields ->> 'client_name',
    client_email = p_fields ->> 'client_email',
    client_tax_id = p_fields ->> 'client_tax_id',
    client_address = p_fields ->> 'client_address',
    valid_until = (p_fields ->> 'valid_until')::date,
    margin_percent = (p_fields ->> 'margin_percent')::numeric,
    tax_rate_percent = (p_fields ->> 'tax_rate_percent')::numeric,
    tax_label = p_fields ->> 'tax_label',
    conditions = p_fields ->> 'conditions',
    discount_percent = coalesce((p_fields ->> 'discount_percent')::numeric, 0),
    discount_fixed_minor = coalesce((p_fields ->> 'discount_fixed_minor')::bigint, 0),
    discount_minor = coalesce((p_fields ->> 'discount_minor')::bigint, 0),
    total_cost_minor = (p_fields ->> 'total_cost_minor')::bigint,
    price_before_tax_minor = (p_fields ->> 'price_before_tax_minor')::bigint,
    tax_minor = (p_fields ->> 'tax_minor')::bigint,
    total_minor = (p_fields ->> 'total_minor')::bigint
  where id = p_quote_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.quote_items where quote_id = p_quote_id;
  insert into public.quote_items (quote_id, position, kind, nature, section, description, quantity, unit, unit_cost_minor, total_cost_minor)
  select p_quote_id, x.position, x.kind, coalesce(x.nature, 'service'), nullif(btrim(coalesce(x.section, '')), ''), x.description, x.quantity,
         x.unit, x.unit_cost_minor, x.total_cost_minor
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(position smallint, kind text, nature text, section text, description text, quantity numeric, unit text, unit_cost_minor bigint,
         total_cost_minor bigint);
  return public.snapshot_quote(p_quote_id);
end;
$$;
revoke all on function public.save_quote_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_quote_content(uuid, jsonb, jsonb) to authenticated;
