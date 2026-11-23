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
| `market_sources`, `market_series`, `market_observations` (1400) | Catálogo de fontes oficiais (licença, ligação, estado da última recolha), séries com o pedido de recolha (`fetch_spec`) e observações mensais tal como publicadas (`value`, `change_month`, `change_year`). Legíveis por quem tem sessão; só o agente escreve. |
| `market_watches`, `market_alerts` (1400) | Acompanhamento por pessoa/organização com limiar em p.p. e alertas criados pelo agente (únicos por acompanhamento e mês). `business.*`; o leitor marca alertas como lidos. |
| `private.run_market_agent()` | Agente de mercado: recolhe, guarda, regista em `job_runs`, cria alertas. pg_cron `anen-market-agent` às 06:30 UTC. `public.run_market_agent_now()` só para administradores da plataforma. |
| `recipe_ingredients` (+, 1300) | `supplier_price_id`: preço de fornecedor de onde veio `package_price_minor` (mesmo âmbito e moeda; `on delete set null`). Ligação nova só com `business.read`. |
| `recipe_ingredients` (+, 2000) | `stock_item_id`: artigo de stock de onde sai o ingrediente nas produções (mesmo âmbito; unidade convertível, senão `stock_unit_mismatch`; `on delete set null`). Ligação nova só com `business.read`. |
| `recipe_productions` (2000) | Produção registada de uma ficha (`portions`, `occurred_on`, `notes`, cópia de `recipe_name`). Só leitura (`business.read`); criada por `produce_recipe`. |
| `produce_recipe(p_recipe_id, p_portions, p_occurred_on?, p_notes?)` | SECURITY DEFINER; exige `quotes.read` e `business.write`. Dá saída de cada ingrediente ligado: quantidade × porções ÷ porções da ficha ÷ (1 − desperdício), convertida (`private.unit_ratio`, espelho de `units.ts`), 3 casas a meio para cima, mínimo 0,001. Tudo ou nada; `recipe_no_stock_links` se nada está ligado. Os movimentos ficam com `production_id` (só esta função o pode pôr). |
| `recipe_price_updates(p_recipe_id?)` | SECURITY INVOKER. Ingredientes ligados com um preço mais recente do mesmo artigo (nome normalizado + unidade + moeda) no mesmo fornecedor, ou com o registo corrigido. |
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

## Compras e inventário (migration 1500)

| Tabela / função | Notas |
|---|---|
| `stock_items` | Artigo em stock por pessoa ou organização: `name` (único no âmbito), `sku`, `unit` e `currency_code` (fixos), `min_quantity`, `target_quantity`, `preferred_supplier_id` (fornecedor do mesmo âmbito). `quantity_on_hand` e `average_cost_minor` são calculados pelo servidor (o cliente não os escreve). Com movimentos não se apaga: arquiva-se. RLS `business.*`, auditado. |
| `stock_movements` | Imutável (só `select` e `insert`). `kind`: `in` (custo obrigatório), `out`, `loss` (sem saldo negativo) e `count` (quantidade contada). O trigger `apply_stock_movement` bloqueia o artigo, calcula o custo médio ponderado com divisão inteira exata a meio para cima e guarda `quantity_change`, `balance_after` e `average_cost_after`. |
| `stock_movements` (+, 2000) | `lot_code` e `expires_on` (só em `in`: criam o lote), `lot_id` (só em `out`/`loss`: consome só desse lote, senão `stock_lot_invalid`), `production_id`. |
| `stock_lots` (2000) | Lote por entrada (`origin` `in`), contagem acima do saldo (`count`) ou saldo anterior à migration (`opening`). `quantity_remaining` desce por FEFO (validade mais próxima, sem validade no fim, depois a mais antiga) no trigger AFTER `apply_stock_lots`. Invariante: soma dos lotes = `quantity_on_hand`. Só leitura (`business.read`). |
| `stock_lot_movements` (2000) | Rastreio: quanto cada movimento tirou (negativo) ou criou (positivo) em cada lote. Só leitura. |
| `purchase_orders` | Encomenda a um fornecedor: `status` draft → ordered → received (só pela receção) / cancelled; `project_id` na mesma moeda; `total_minor` mantido pelo servidor; bloqueada depois de recebida ou cancelada. Só se apagam rascunhos e canceladas. |
| `purchase_order_items` | Linhas (acesso herdado da encomenda). Com `stock_item_id`: mesmo âmbito e moeda, e a unidade passa a ser a do artigo. `total_minor = round(quantidade × preço)`. |
| `receive_purchase_order(order, data, conta?, paga?, descrição?)` | SECURITY DEFINER com verificações explícitas (`business.write`; com conta, `finance.write` e conta do mesmo âmbito e moeda). Numa transação: entradas de stock, `supplier_prices` por linha, despesa (paga ou com vencimento pelo prazo do fornecedor, `cost_kind = material` com projeto) e estado `received`. |
| `stock_reorder_suggestions(p_org)` | SECURITY INVOKER. Artigos abaixo do mínimo; sugere até `target_quantity` (ou o mínimo) menos o saldo e o que já está em encomendas por receber; fornecedor habitual ou o da última compra recebida e o último preço pago. |
| `create_reorder_drafts(p_org)` | SECURITY INVOKER. Um rascunho por fornecedor e moeda; os artigos sem fornecedor ficam de fora e são contados. |

## Notificações e relatórios (migration 1600)

| Tabela / função | Notas |
|---|---|
| `notifications` | De uma pessoa (`user_id`), opcionalmente no contexto de uma organização. `kind`: `payment_overdue`, `payment_due_soon`, `stock_below_minimum`, `purchase_late`, `market_alert`; `data` (parâmetros do texto), `link` (caminho interno validado), `dedupe_key` único por pessoa. Só o servidor cria. RLS: a própria pessoa e, nas de organização, só com a permissão do tipo (`finance.read` para pagamentos; `business.read` para os outros). O cliente só altera `read_at`. |
| `notification_settings` | Por pessoa: `disabled_kinds` e `due_soon_days` (1 a 30, por omissão 3). RLS: só a própria. |
| `notifications`/`notification_settings` (+, 2000) | Tipos novos `stock_expiring` (lote com quantidade que vence até `expiry_soon_days`, 1 a 60, por omissão 7) e `stock_expired` (vencido com quantidade); uma vez por lote e validade. |
| `private.generate_notifications(p_today, p_user)` | Gera as que faltam (idempotente). O stock avisa uma vez por episódio (desde a última vez que esteve no mínimo ou acima); os pagamentos, uma vez por vencimento. |
| `refresh_my_notifications()` | SECURITY DEFINER, só para a própria pessoa; corre ao abrir `/notificacoes`. |
| `private.run_notification_jobs()` | Tarefa diária `anen-notifications` (06:45 UTC): gera para todos, apaga as lidas há mais de 90 dias e todas com mais de 180, e regista a execução em `job_runs`. |
| `finance_report(p_org, p_from, p_to)` | SECURITY INVOKER. `grouping sets` por categoria, contacto, projeto, centro de custo e total, com receita e despesa faturadas (`amount_minor`) e liquidadas (`settled_minor`). |

## Planos e ANEN AI (migration 1700)

| Tabela / função | Notas |
|---|---|
| `plans` | `free`, `pro`, `max` com `ai_daily_limit` (0, 25, 100). Leitura para autenticados; escrita só por `admin_set_ai_limit` (administradores da plataforma). |
| `subscriptions` | Plano por âmbito (pessoa ou organização), uma ativa por âmbito, `current_period_end` opcional, `source` manual/stripe. Sem cobrança ainda: `admin_set_plan` (administradores). Membros veem a da organização. Auditado. |
| `private.current_plan` | Plano em vigor (sem subscrição ativa e dentro do prazo = Free). |
| `ai_conversations`, `ai_messages` | Privadas de quem pergunta; as de organização só enquanto for membro ativo. `ai_messages.sources` (ligações geradas pelas ferramentas, não pelo modelo) e `tools`. |
| `ai_consents` | A pessoa aceita o envio da pergunta e dos dados consultados ao fornecedor do modelo. |
| `ai_digests` | Resumos da ANEN AI do centro de inteligência, privados de quem os gera (como as conversas). Um por pessoa, âmbito, tipo (`week`/`month`) e dia final; não se editam. |
| `ai_usage` | Uma linha por pergunta, no dia do fuso do âmbito. `ai_begin_request` reserva com trava por âmbito (erros `ai_consent_required`, `ai_plan_required`, `ai_daily_limit`); `ai_finish_request` grava modelo e tokens, e uma falha do fornecedor devolve a vaga. Só administradores leem. |
| `ai_status(p_org)` | Plano, limite, usadas hoje e consentimento, para a interface. |

## Faturação certificada via InvoiceXpress (migration 1800)

| Tabela | Notas |
|---|---|
| `invoicing_connections` | Uma conta InvoiceXpress por pessoa ou organização: `account_name` (só subdomínio), chave da API **cifrada pela aplicação** (AES-256-GCM, chave mestra `INVOICING_ENCRYPTION_KEY` só no servidor; a BD guarda `api_key_ciphertext` e os 4 últimos caracteres), cache de `taxes`/`sequences` e `load_address` (local de carga das guias). RLS `finance.*`. Auditada. |
| `fiscal_documents` | Cópia local dos documentos emitidos no InvoiceXpress: fatura, fatura-recibo, fatura simplificada, nota de crédito, guia de transporte e de remessa. `provider_id`, `proprietary_uid` (idempotência), `sequence_number`, `atcud`, `saft_hash`, `at_doc_code` (código AT das guias), cliente (fotografia), ligações a contacto, orçamento, projeto, movimento e documento de origem. Depois de emitido, o conteúdo fica bloqueado; estados draft → final/settled → canceled (com motivo). Só os rascunhos se apagam. |
| `fiscal_document_lines` | Linhas (nome ≤ 60, quantidade, preço, IVA, desconto, artigo de stock); bloqueadas depois de emitido. |

## Workspaces (migration 2700, Dual Workspace Fase 2)

Detalhe em [WORKSPACE_DATA_MODEL.md](WORKSPACE_DATA_MODEL.md).

| Objeto | Notas |
|---|---|
| `workspaces` (vista) | `security_invoker`. O espaço pessoal (`PERSONAL`, id = utilizador, de `user_preferences`) e as organizações em que a pessoa é membro ativo (`BUSINESS`). Só leitura |
| `workspace_members` (vista) | No pessoal, o próprio como `owner`; nas organizações, `organization_members` com a chave da função. Só leitura |
| `private.can_access_workspace(type, id, permission?)` / `public.can_access_workspace` | Pessoal só o próprio; empresarial: membro ativo ou `has_org_permission` |
| `ensure_personal_workspace()` | SECURITY DEFINER, idempotente: repõe o perfil e as preferências em falta sem alterar o que existe |

## Próximas fases

As tabelas de finanças, orçamentos, custos, fiscalidade, marketplace, CRM, assinaturas, IA e administração listadas no prompt mestre serão criadas por migration em cada fase, sempre com `organization_id`, RLS por `has_org_permission` e auditoria.
