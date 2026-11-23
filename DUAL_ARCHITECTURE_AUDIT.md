# Auditoria para a arquitetura Dual (Pessoal e Empresarial)

_Fase 1 do prompt "Dual Workspace Architecture" v1.3 · 23/11/2026._ Revisão funcional em [QA_REVIEW.md](QA_REVIEW.md).

## 1. Conclusão principal

**A ANEN já tem, na base de dados, a separação entre o espaço pessoal e as organizações.** Não está organizada como uma tabela `workspaces`, mas o efeito é o mesmo:

- Cada registo de um espaço tem `owner_user_id` (pessoal) **ou** `organization_id` (organização), nunca os dois. Uma restrição `check ((organization_id is null) <> (owner_user_id is null))` garante isto em 18 migrations e cobre todas as entidades financeiras e operacionais.
- O RLS decide o acesso: no espaço pessoal só o próprio, numa organização por `private.has_org_permission` e pela permissão do módulo (`finance.*`, `business.*`, `quotes.*`…).
- Os gatilhos recusam ligações entre espaços diferentes (conta, categoria, contacto, projeto, centro de custo, artigo de stock), com os erros `account_invalid`, `category_invalid`, `contact_invalid`, etc.
- As colunas de âmbito não estão nos `grant update`, por isso um registo não muda de espaço numa edição (há um teste para isto).
- O contexto ativo fica em `user_preferences.active_organization_id`, validado por gatilho: só aceita organizações em que a pessoa é membro ativo.

Por isso, a Fase 2 não precisa de recriar tabelas nem de migrar dados. Proponho adaptar o que existe (ver §6), e esta decisão fica à espera de aprovação.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Web | Next.js 16.4 (App Router, Server Components e Server Actions), React 19.3, Tailwind 4 |
| Backend | Supabase: Auth, PostgREST, Postgres 17 com RLS, Storage e `pg_cron`. Não há servidor próprio; a chave de serviço não é usada na app web |
| Pacotes | `@anen/financial-engine` (Money em `bigint`), `@anen/validation` (Zod), `@anen/i18n` (pt-PT e pt-BR), `@anen/types`, `@anen/ui` (tokens) |
| Testes | Vitest: 409 testes, incluindo RLS em Postgres 17 real via PGlite. Playwright E2E corre contra produção |
| IA | Gemini, por adaptador próprio com ferramentas determinísticas (`lib/ai/tools.ts`) |
| Externos | InvoiceXpress (faturação PT), InfinitePay e IBAN (planos), Eurostat e IBGE (mercado), Web Push (VAPID), Vercel |

## 3. Mapa: entidades do prompt e o que já existe

| Prompt | Existe como | Estado |
|---|---|---|
| users | `auth.users` + `users_profiles` + `user_preferences` (locale, fuso, país e moeda independentes) | Existe |
| workspaces (PERSONAL) | Implícito: o utilizador (`owner_user_id`) | Existe, mas sem linha própria |
| workspaces (BUSINESS) | `organizations` (`kind` independent ou business, país, região, moeda, fuso, NIF/CNPJ) | Existe |
| workspace_members | `organization_members` (função, estado active/suspended) + `organization_invitations` (token com hash, 7 dias) | Existe |
| workspace_settings | `organizations` + `user_preferences` + `notification_settings` | Existe, repartido |
| Accounts, Transactions, Income/Expenses | `financial_accounts`, `transactions` (`kind` income/expense, pendente/parcial/pago, vencimento) | Existe |
| Budgets, FinancialGoals | `budgets`, `savings_goals` | Existe |
| RecurringTransactions | `recurring_transactions` (semanal, mensal ou anual; `end_on`; fim de mês; pendentes com vencimento) | Existe, **sem parcelas** (ver §5) |
| Invoices | `fiscal_documents` (InvoiceXpress) | Existe |
| Quotes, Projects, Customers/Suppliers | `quotes`, `projects`, `contacts` (client, supplier, both) | Existe |
| Products, Inventory, PurchaseOrders | `stock_items`, `stock_movements`, `stock_lots`, `purchase_orders` | Existe |
| Recipes, PriceObservations | `recipes`, `recipe_ingredients`, `supplier_prices`, `market_*` | Existe |
| Reports | `finance_report()` (função, sem tabela) | Existe |
| AIConversations | `ai_conversations`, `ai_messages`, `ai_digests`, `ai_usage` | Existe, por âmbito |
| cross_workspace_transfers | — | **Não existe** (Fase 7) |
| Papéis Owner, Admin, Manager, Finance, Employee, Viewer | `owner` (100), `admin` (80), `manager` (60), `accountant` (40), `employee` (30), `viewer` (10), mais funções personalizadas por organização | Existe; "Finance" corresponde a `accountant` |
| Planos Free, Pro e Max | `plans`, `subscriptions` por âmbito; checkout InfinitePay e IBAN | Existe; os limites cobrem só a IA |
| Auditoria | `audit_logs` (organizações, membros, convites, funções, preços, faturação…) | Existe |

## 4. Autenticação e sessão

- `proxy.ts` renova a sessão. `lib/session.ts#getSession` carrega o perfil, as preferências e as organizações com permissões, uma vez por pedido e sempre por RLS.
- Há registo, login, recuperação, verificação de email e eliminação de conta (RGPD/LGPD). O login Google está implementado mas desativado.
- `switchContextAction` só aceita uma organização da lista de membros, e a base de dados volta a validar por gatilho.

## 5. Lacunas face ao prompt

| # | Lacuna | Fase |
|---|---|---|
| L1 | O contexto ativo é global à conta, guardado no servidor, e não está no endereço. Duas abas em contextos diferentes gravam no contexto que estiver ativo **no momento de gravar** (QA-03) | 3/4 |
| L2 | O menu é igual nos dois contextos: o pessoal mostra Compras, Inventário, Faturação… | 4 |
| L3 | Não há um menu pessoal dedicado ("Hoje", Assinaturas, Dívidas, Calendário) | 5 |
| L4 | Não há parcelas: falta número da parcela, total da série, valor total vs. por parcela, acerto de cêntimos na última parcela, estado por parcela e cancelamento das restantes | 5 |
| L5 | Não há transferências entre espaços | 7 |
| L6 | Os limites dos planos cobrem só a IA (não há limites de organizações, utilizadores, movimentos, projetos…) | 9 |
| L7 | Os E2E correm contra produção (não há staging) | 10 |
| L8 | Não há linter configurado (só `tsc` estrito) | 1/10 |

## 6. Decisão pedida para a Fase 2: tabela `workspaces` ou adaptar o modelo atual

**Opção A (recomendada): manter o modelo `owner_user_id` / `organization_id` e acrescentar uma camada "workspace".**
- No código: um tipo `WorkspaceRef = { type: "PERSONAL"; userId } | { type: "BUSINESS"; orgId }`, a partir do qual `financeScope` e `businessScope` passam a ser derivados.
- Na base de dados: uma vista `workspaces`, só de leitura, que junta o espaço pessoal de cada pessoa e as organizações; e uma função `private.can_access_workspace`.
- Não há migração de dados, nem risco para as 68 tabelas e os 409 testes, e a reversão é simples (apagar a vista e a função).

**Opção B: criar a tabela `workspaces` e passar todas as tabelas para `workspace_id`.**
- Exige migrar 35 tabelas com `organization_id` e reescrever todas as políticas RLS, gatilhos e funções.
- O risco de regressões e de perda de dados é alto, sem ganho de segurança: o isolamento já está provado pelos testes.

## 7. Compatibilidade, migração e reversão

- Com a opção A não se mexe em dados. Com a B seria preciso um plano completo (`DATA_MIGRATION_PLAN.md`), com contagens antes e depois por tabela e reversão por migration inversa.
- Não há dados ambíguos: cada registo já pertence a um único espaço por restrição. Não há dados de demonstração (os dados de referência — moedas, países, regiões, fontes de mercado — são reais).
- Para reverter uma fase, cada migration nova leva uma migration de reversão documentada. As alterações de código revertem-se com `git revert` dos commits da fase.

## 8. Zona protegida: identidade visual (não alterar)

| O quê | Onde |
|---|---|
| Logótipo | `apps/web/public/logo.svg` |
| Ícone da app e favicon | `apps/web/src/app/icon.svg`, `apps/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` |
| Manifesto (cores da PWA) | `apps/web/src/app/manifest.ts` |
| Tokens de cor | `packages/ui/src/index.ts`, `packages/ui/src/theme.css` |
| Estilos globais e temas (escuro, claro, rosa claro, alto contraste) | `apps/web/src/app/globals.css` |
| Fontes (Manrope, Inter, Atkinson Hyperlegible para acessibilidade) | `apps/web/src/app/layout.tsx` |

Valores no código, comparados com a secção 10 do prompt: preto `#090909`, preto secundário `#141414` (token `surface`), superfícies `#202020` (`graphite`), `#353535` (`graphiteSoft`), branco `#FFFFFF` e laranja `#FF851B` (`brand`). **Todos coincidem.** No tema claro há um laranja-escuro só para texto, já existente e conforme à regra "não usar laranja em texto pequeno sobre branco".

Verificação desta fase: `git diff` nestes ficheiros está vazio.

## 9. Dependências externas

| Dependência | Para quê | Estado |
|---|---|---|
| Supabase (eu-west-1) | Base de dados, autenticação e Storage | Ativo |
| Vercel | Alojamento e cron do push | Ativo |
| Gemini | ANEN AI | Ativo (chave no servidor) |
| InvoiceXpress | Faturação certificada em Portugal | Ativo, por cliente |
| InfinitePay, IBAN | Planos pagos | Ativo |
| Eurostat, IBGE | Índices de mercado | Ativo (pg_cron) |
| Serviço de email (SMTP/Resend) | Convites por email, resumos | **Em falta** |
| Projeto Supabase de staging | E2E fora de produção | **Em falta** |
