-- ANEN · Faturação certificada (Portugal) através do InvoiceXpress.
--
-- A ANEN NÃO é um programa de faturação certificado pela AT. Os documentos fiscais (faturas, faturas-recibo,
-- faturas simplificadas, notas de crédito, guias de transporte e de remessa) são emitidos pelo InvoiceXpress
-- (certificado pela AT), na conta de cada cliente: é ele que numera, assina (hash), gera ATCUD e QR, comunica à AT
-- e devolve o código AT das guias. A ANEN prepara o documento a partir dos dados que já tem, envia-o pela API,
-- guarda uma cópia de consulta e liga-o às finanças (valor a receber), ao stock (saída) e aos projetos.
--
-- 1. invoicing_connections: a conta InvoiceXpress de cada pessoa ou organização. A chave da API fica CIFRADA pela
--    aplicação (AES-256-GCM, chave só no servidor); a base de dados nunca vê a chave em claro.
-- 2. fiscal_documents + fiscal_document_lines: cópia local. Depois de finalizado, o conteúdo não muda
--    (o original é o do InvoiceXpress); só o estado (anulação), o código AT e as ligações.

create table public.invoicing_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  provider text not null default 'invoicexpress' check (provider in ('invoicexpress')),
  account_name text not null check (account_name ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  api_key_ciphertext text not null check (char_length(api_key_ciphertext) between 20 and 2000),
  api_key_hint text not null check (char_length(api_key_hint) <= 8),
  organization_name text check (char_length(organization_name) <= 200),
  -- Impostos e séries da conta (cache para os formulários; atualizados ao ligar e a pedido).
  taxes jsonb not null default '[]'::jsonb,
  sequences jsonb not null default '[]'::jsonb,
  -- Local de carga por omissão nas guias (morada da empresa/armazém): {detail, city, postal_code, country}.
  load_address jsonb,
  verified_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoicing_connections_scope check ((organization_id is null) <> (owner_user_id is null))
);
create unique index invoicing_connections_org_idx on public.invoicing_connections (organization_id) where organization_id is not null;
create unique index invoicing_connections_owner_idx on public.invoicing_connections (owner_user_id) where owner_user_id is not null;

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  connection_id uuid references public.invoicing_connections (id) on delete set null,
  kind text not null check (kind in ('invoice', 'invoice_receipt', 'simplified_invoice', 'credit_note', 'transport', 'shipping')),
  status text not null default 'draft' check (status in ('draft', 'final', 'settled', 'canceled')),
  -- Identificação no InvoiceXpress (o documento oficial).
  provider_id bigint not null,
  proprietary_uid uuid not null unique,
  sequence_number text check (char_length(sequence_number) <= 60),
  atcud text check (char_length(atcud) <= 120),
  saft_hash text check (char_length(saft_hash) <= 20),
  at_doc_code text check (char_length(at_doc_code) <= 120),
  permalink text check (permalink ~ '^https://' and char_length(permalink) <= 500),
  -- Cliente (fotografia no momento da emissão) e ligações.
  contact_id uuid references public.contacts (id) on delete set null,
  client_name text not null check (char_length(btrim(client_name)) between 1 and 200),
  client_fiscal_id text check (char_length(client_fiscal_id) <= 30),
  client_email text check (char_length(client_email) <= 254),
  client_address text check (char_length(client_address) <= 400),
  client_city text check (char_length(client_city) <= 120),
  client_postal_code text check (char_length(client_postal_code) <= 20),
  client_country text check (char_length(client_country) <= 60),
  quote_id uuid references public.quotes (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,
  owner_document_id uuid references public.fiscal_documents (id) on delete set null,
  -- Datas e valores (valores devolvidos pelo InvoiceXpress, em unidades mínimas).
  issue_date date not null,
  due_date date,
  currency_code char(3) not null default 'EUR' references public.currencies (code),
  before_taxes_minor bigint check (before_taxes_minor >= 0),
  taxes_minor bigint check (taxes_minor >= 0),
  total_minor bigint check (total_minor >= 0),
  reference text check (char_length(reference) <= 120),
  observations text check (char_length(observations) <= 2000),
  tax_exemption text check (tax_exemption ~ '^M[0-9]{2}$'),
  -- Guias.
  loaded_at timestamptz,
  license_plate text check (char_length(license_plate) <= 20),
  address_from jsonb,
  address_to jsonb,
  stock_out boolean not null default false,
  stock_applied_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint fiscal_documents_scope check ((organization_id is null) <> (owner_user_id is null)),
  constraint fiscal_documents_guide check (kind not in ('transport', 'shipping') or (loaded_at is not null and address_from is not null and address_to is not null))
);
create unique index fiscal_documents_provider_idx on public.fiscal_documents (connection_id, provider_id) where connection_id is not null;
create index fiscal_documents_org_idx on public.fiscal_documents (organization_id, issue_date desc) where organization_id is not null;
create index fiscal_documents_owner_idx on public.fiscal_documents (owner_user_id, issue_date desc) where owner_user_id is not null;
create index fiscal_documents_contact_idx on public.fiscal_documents (contact_id) where contact_id is not null;

create table public.fiscal_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.fiscal_documents (id) on delete cascade,
  position smallint not null check (position between 0 and 500),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 200),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 9007199254740991),
  tax_name text check (char_length(tax_name) <= 40),
  tax_percent numeric(6, 3) check (tax_percent between 0 and 100),
  discount_percent numeric(6, 3) not null default 0 check (discount_percent between 0 and 100),
  stock_item_id uuid references public.stock_items (id) on delete set null
);
create index fiscal_document_lines_doc_idx on public.fiscal_document_lines (document_id, position);

-- ---------------------------------------------------------------------------
-- Integridade
-- ---------------------------------------------------------------------------
-- Depois de finalizado, o documento é o do InvoiceXpress: o conteúdo não muda. Mudanças permitidas:
-- estado final/settled -> canceled (com motivo), final <-> settled, código AT, ligações (on delete set null) e a baixa de stock.
create or replace function private.guard_fiscal_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.connection_id is not null and not exists (
      select 1 from public.invoicing_connections c
      where c.id = new.connection_id
        and c.organization_id is not distinct from new.organization_id
        and c.owner_user_id is not distinct from new.owner_user_id
    ) then
      raise exception 'invoicing_not_connected' using errcode = '22023';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.contacts c where c.id = new.contact_id
        and c.organization_id is not distinct from new.organization_id and c.owner_user_id is not distinct from new.owner_user_id
    ) then
      raise exception 'contact_invalid' using errcode = '22023';
    end if;
    if new.project_id is not null and not exists (
      select 1 from public.projects p where p.id = new.project_id
        and p.organization_id is not distinct from new.organization_id and p.owner_user_id is not distinct from new.owner_user_id
    ) then
      raise exception 'project_invalid' using errcode = '22023';
    end if;
    if new.owner_document_id is not null and not exists (
      select 1 from public.fiscal_documents d where d.id = new.owner_document_id
        and d.organization_id is not distinct from new.organization_id and d.owner_user_id is not distinct from new.owner_user_id
        and d.kind in ('invoice', 'invoice_receipt', 'simplified_invoice') and d.status in ('final', 'settled')
    ) then
      raise exception 'fiscal_document_invalid' using errcode = '22023';
    end if;
    return new;
  end if;
  if old.status <> 'draft' and (
       new.kind, new.provider_id, new.sequence_number, new.atcud, new.saft_hash, new.client_name, new.client_fiscal_id,
       new.issue_date, new.due_date, new.currency_code, new.before_taxes_minor, new.taxes_minor, new.total_minor,
       new.loaded_at, new.address_from, new.address_to, new.license_plate, new.tax_exemption
     ) is distinct from (
       old.kind, old.provider_id, old.sequence_number, old.atcud, old.saft_hash, old.client_name, old.client_fiscal_id,
       old.issue_date, old.due_date, old.currency_code, old.before_taxes_minor, old.taxes_minor, old.total_minor,
       old.loaded_at, old.address_from, old.address_to, old.license_plate, old.tax_exemption
     ) then
    raise exception 'fiscal_document_locked' using errcode = '22023';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('final', 'settled'))
       or (old.status in ('final', 'settled') and new.status = 'canceled' and nullif(btrim(coalesce(new.cancel_reason, '')), '') is not null)
       or (old.status = 'final' and new.status = 'settled')
       or (old.status = 'settled' and new.status = 'final')
     ) then
    raise exception 'fiscal_status_invalid' using errcode = '22023';
  end if;
  if new.status in ('final', 'settled') and old.status = 'draft' then
    new.finalized_at := coalesce(new.finalized_at, now());
  end if;
  return new;
end;
$$;

create or replace function private.guard_fiscal_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.fiscal_documents%rowtype;
begin
  select * into v_doc from public.fiscal_documents where id = case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  if tg_op = 'DELETE' then
    if found and v_doc.status <> 'draft' then
      raise exception 'fiscal_document_locked' using errcode = '22023';
    end if;
    return old;
  end if;
  -- O artigo apagado (on delete set null) não é edição.
  if tg_op = 'UPDATE' and new.stock_item_id is null and old.stock_item_id is not null
     and (new.name, new.quantity, new.unit_price_minor) is not distinct from (old.name, old.quantity, old.unit_price_minor) then
    return new;
  end if;
  if not found or v_doc.status <> 'draft' then
    raise exception 'fiscal_document_locked' using errcode = '22023';
  end if;
  if new.stock_item_id is not null and not exists (
    select 1 from public.stock_items s where s.id = new.stock_item_id
      and s.organization_id is not distinct from v_doc.organization_id and s.owner_user_id is not distinct from v_doc.owner_user_id
  ) then
    raise exception 'stock_item_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger invoicing_connections_scope before insert or update on public.invoicing_connections for each row execute function private.set_creator_and_lock_scope();
create trigger invoicing_connections_updated_at before update on public.invoicing_connections for each row execute function private.set_updated_at();
create trigger invoicing_connections_audit after insert or update or delete on public.invoicing_connections for each row execute function private.audit_row_change();
create trigger fiscal_documents_scope before insert or update on public.fiscal_documents for each row execute function private.set_creator_and_lock_scope();
create trigger fiscal_documents_guard before insert or update on public.fiscal_documents for each row execute function private.guard_fiscal_document();
create trigger fiscal_documents_updated_at before update on public.fiscal_documents for each row execute function private.set_updated_at();
create trigger fiscal_documents_audit after insert or update or delete on public.fiscal_documents for each row execute function private.audit_row_change();
create trigger fiscal_document_lines_guard before insert or update or delete on public.fiscal_document_lines for each row execute function private.guard_fiscal_line();

-- ---------------------------------------------------------------------------
-- RLS: faturação é finanças (finance.read para ver, finance.write para ligar e emitir).
-- ---------------------------------------------------------------------------
alter table public.invoicing_connections enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_lines enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['invoicing_connections', 'fiscal_documents'] loop
    execute format('create policy "finance read" on public.%I for select to authenticated using (private.can_access_finance(organization_id, owner_user_id, false))', t);
    execute format('create policy "finance insert" on public.%I for insert to authenticated with check (private.can_access_finance(organization_id, owner_user_id, true))', t);
    execute format('create policy "finance update" on public.%I for update to authenticated using (private.can_access_finance(organization_id, owner_user_id, true)) with check (private.can_access_finance(organization_id, owner_user_id, true))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
end;
$$;
-- A ligação desliga-se (apaga-se); os documentos não se apagam (são fiscais) — só os rascunhos.
create policy "finance delete" on public.invoicing_connections for delete to authenticated
  using (private.can_access_finance(organization_id, owner_user_id, true));
create policy "finance delete drafts" on public.fiscal_documents for delete to authenticated
  using (status = 'draft' and private.can_access_finance(organization_id, owner_user_id, true));

create policy "read" on public.fiscal_document_lines for select to authenticated
  using (exists (select 1 from public.fiscal_documents d where d.id = document_id and private.can_access_finance(d.organization_id, d.owner_user_id, false)));
create policy "write" on public.fiscal_document_lines for all to authenticated
  using (exists (select 1 from public.fiscal_documents d where d.id = document_id and private.can_access_finance(d.organization_id, d.owner_user_id, true)))
  with check (exists (select 1 from public.fiscal_documents d where d.id = document_id and private.can_access_finance(d.organization_id, d.owner_user_id, true)));
revoke all on public.fiscal_document_lines from anon;
revoke truncate on public.fiscal_document_lines from authenticated;

revoke update on public.invoicing_connections from authenticated;
grant update (account_name, api_key_ciphertext, api_key_hint, organization_name, taxes, sequences, load_address, verified_at) on public.invoicing_connections to authenticated;
