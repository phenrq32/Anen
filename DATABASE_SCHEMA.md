# Esquema da base de dados

Fonte de verdade: `supabase/migrations/*.sql`. Todas as tabelas têm RLS ativo.

## Fase 1

### Referência (leitura pública, escrita só pelo service_role)

| Tabela | Conteúdo |
|---|---|
| `languages` | pt-PT, pt-BR (ativos), en, es (preparados) |
| `currencies` | EUR, BRL (ativos), USD; `minor_unit` define as casas decimais |
| `countries` | PT, BR, com moeda, idioma e fuso por omissão |
| `regions` | PT: continente, Açores e Madeira (jurisdições de IVA). BR: 26 estados e o DF (ISO 3166-2), com fuso horário |

### Identidade

| Tabela | Chave | Notas |
|---|---|---|
| `users_profiles` | `id` → `auth.users` | Criado por trigger no registo. O utilizador só edita `full_name`, `avatar_path`, `primary_account_type` e `onboarded_at`. |
| `user_preferences` | `user_id` → `auth.users` | País, idioma, moeda e fuso independentes. `active_organization_id` é validado por trigger (tem de ser membro ativo). |

### Organizações e RBAC

| Tabela | Notas |
|---|---|
| `organizations` | `kind` ∈ independent, business. `tax_id` normalizado e validado por `private.is_valid_tax_id` (NIF/NIPC, CPF, CNPJ alfanumérico). A região tem de pertencer ao país. |
| `permissions` | Catálogo: `organization.update`, `organization.delete`, `members.invite`, `members.manage`, `roles.manage`, `audit.read` |
| `roles` | Sistema (`organization_id` null) ou personalizadas por organização. `rank` define a hierarquia. |
| `role_permissions` | N:N |
| `organization_members` | Único por (organização, utilizador). Estado `active` ou `suspended`. A função tem de ser de sistema ou da mesma organização. |
| `organization_invitations` | Guarda só o **hash SHA-256** do token (256 bits). Expira em 7 dias. Um convite pendente por email. A coluna `token_hash` não é legível pelos clientes. |

### Auditoria e plataforma

| Tabela | Notas |
|---|---|
| `audit_logs` | Escrito por triggers em organizações, membros, convites, funções, permissões e `admin_users`. Sem FK para sobreviver à eliminação da organização. O `token_hash` é removido dos metadados. |
| `admin_users` | Administradores da plataforma (painel admin, fases seguintes) |
| `feature_flags` | `auth.google`, `invitations.email_delivery` |
| `system_settings` | `limits.organizations_per_user` (provisório até haver planos) |

### Funções RPC (`public`, só `authenticated`)

| Função | Regra |
|---|---|
| `create_organization` | O criador fica proprietário e a organização passa a ser o contexto ativo. Limite anti-abuso configurável. |
| `invite_member` | Exige `members.invite` e uma função de nível inferior ao próprio. Devolve o token uma única vez. |
| `get_invitation` | Pré-visualização por token (também `anon`) |
| `accept_invitation` | O email da conta (confirmado) tem de ser o convidado |
| `revoke_invitation` | `members.invite` ou `members.manage` |
| `update_member` / `remove_member` | Hierarquia, nada sobre si próprio exceto sair, e nunca deixar a organização sem proprietário |
| `upsert_role` / `delete_role` | `roles.manage`, só permissões que o próprio tem, nível inferior ao próprio, e não eliminar uma função em uso |

### Funções auxiliares (`private`, não expostas pela API)

`is_org_member`, `has_org_permission`, `member_rank`, `shares_organization`, `is_platform_admin`, `can_assign_rank`, `is_valid_tax_id`, `assert_valid_timezone`.

## Prompt 02 · Fase A (migration 0700)

| Tabela / função | Notas |
|---|---|
| `contacts` | Clientes e fornecedores (`kind` client, supplier, both). Âmbito pessoal ou de organização. RLS por `business.*`. |
| `contact_notes` | Observações datadas de um contacto (`kind` note, call, meeting, email, visit; `noted_on`; `body`). Mesmo âmbito do contacto (trigger); o contacto não muda. RLS por `business.*`. |
| `supplier_prices` | Preço unitário observado de um artigo num fornecedor (`item_name`, `unit`, `unit_price_minor`, `currency_code`, `observed_on`), opcionalmente ligado à despesa que o comprova (`transaction_id`: mesmo âmbito, fornecedor e moeda). Só contactos `supplier`/`both`. RLS por `business.*`, auditado. |
| `quotes` (+) | `client_contact_id`: cliente do cadastro (`client`/`both`, mesmo âmbito), bloqueado depois de aceite. Os campos de texto do cliente continuam no orçamento. |
| `cost_centers` | Centros de custo. |
| `projects` | Cliente, orçamento de origem (único), estado, moeda, custo e receita previstos, `description` (até 4000 caracteres, copiada do orçamento). A moeda fica bloqueada quando há movimentos. |
| `quotes` (+, 1200) | `discount_percent` ou `discount_fixed_minor` (nunca os dois), `discount_minor` (valor descontado). Preço antes do desconto = `price_before_tax_minor + discount_minor`. Bloqueados depois de aceite. |
| `quote_items` (+, 1200) | `nature`: `product` ou `service` (por omissão `service`). |
| `transactions` (+) | `contact_id`, `project_id`, `cost_center_id`, `cost_kind`, `due_on`, `net_minor` + `tax_minor` (soma = total), `settled_minor` (0 ≤ liquidado ≤ total; por omissão = total), `payment_status` gerado (pending, partial, paid), `payment_method`, `document_ref`. Ligações validadas por trigger: mesmo âmbito e, no projeto, mesma moeda. |
| `finance_monthly`, `finance_by_category`, `account_balances` | Passam a somar `settled_minor` (caixa). |
| `create_project_from_quote(p_quote_id)` | SECURITY INVOKER. Só orçamentos aceites; idempotente; reutiliza ou cria o cliente. |

## Plano do mês (migration 0800)

| Tabela | Notas |
|---|---|
| `fixed_expenses` | Despesas fixas pessoais (`owner_user_id`), valor editável, categoria de despesa opcional. RLS: só o próprio. |
| `monthly_plans` | Um por pessoa e mês: salário líquido e reserva de emergência já guardada. RLS: só o próprio. |
| `investment_options` | Referência pública por país: `bucket` (reserve, long_term), risco, acesso ao dinheiro, fonte oficial e `reviewed_on`. Escrita só pelo service_role. Sem taxas de rendimento. |

## Próximas fases

As tabelas de finanças, orçamentos, custos, fiscalidade, marketplace, CRM, assinaturas, IA e administração listadas no prompt mestre serão criadas por migration em cada fase, sempre com `organization_id`, RLS por `has_org_permission` e auditoria.
