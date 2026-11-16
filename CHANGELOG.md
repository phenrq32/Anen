# Changelog

## [0.5.0] — 16/11/2026 · Plano do mês (finanças pessoais)
- Salário líquido do mês e reserva de emergência já guardada, por mês (pré-preenchidos com o último plano).
- Despesas fixas com o valor editável no próprio lugar; total e percentagem do salário.
- Sobra ou défice do mês. Em défice: maiores despesas e passos para equilibrar. Com sobra: repartição entre reserva de emergência e longo prazo (motor `computeMonthlyPlan`, regras explicadas na página), orientação adaptada ao tamanho da sobra e projeção sem rendimentos (1, 5 e 10 anos).
- Catálogo `investment_options` por país (PT e BR), com risco, acesso ao dinheiro, fonte oficial e data de revisão. Sem taxas de rendimento: a página aponta para a fonte onde se confirmam as condições atuais. Aviso de orientação educativa.
- Migrations 0700 e 0800 aplicadas em produção; os 12 E2E existentes continuam a passar.

## [0.4.0] — 16/11/2026 · Prompt 02, Fase A: integração financeira
- Auditoria e plano de expansão do prompt mestre 02 em `EXPANSION_PLAN.md`.
- Clientes e fornecedores (`contacts`), centros de custo e projetos, com RLS (`business.read` / `business.write`) e auditoria.
- Movimentos ligados a contacto, projeto, centro de custo e tipo de custo; vencimento; imposto incluído (com `net + imposto = total` garantido na base de dados); pagamento pendente, parcial ou liquidado (`settled_minor`, estado derivado); método de pagamento e n.º de documento.
- Saldo, resumo mensal e despesas por categoria passam a contar o valor liquidado (caixa). Os movimentos existentes foram marcados como liquidados.
- "A receber e a pagar": valores em aberto, vencidos e ação "marcar como liquidado".
- Projetos: previsto vs. real (custo, receita faturada e recebida, lucro, margem), desvio por tipo de custo face às linhas do orçamento e alerta de ultrapassagem. Cálculos no motor `computeProjectFinancials` (determinístico, testado).
- Orçamento aceite → "Criar projeto" (RPC `create_project_from_quote`, idempotente, cria ou reutiliza o cliente).
- Painel: valores a receber e a pagar, projetos em curso e orçamentos recentes (o painel ainda dizia que os orçamentos chegavam numa próxima versão).

## [0.3.0] — 16/11/2026 · Fase 3: Orçamentos e restauração
- Motor de orçamentos e de fichas técnicas no `financial-engine` (exato, testado).
- Orçamentos com 19 modelos por atividade, editor com cálculo ao vivo, versões, estados, bloqueio após aceite e documento imprimível/PDF sem custos internos.
- Fichas técnicas: desperdício, food cost, preço mínimo e recomendado, evolução do custo por dose, comparação.
- Correção (migration 0600): apagar uma conta falhava quando havia dados, porque os triggers bloqueavam `created_by → NULL`. Impedia o direito ao apagamento.

## [0.2.0] — 16/11/2026 · Fase 2: Finanças e produção
- Deploy em produção (Vercel + Supabase) e E2E Playwright contra produção.
- Finanças pessoais e de organização: contas, movimentos, categorias, recorrentes, orçamentos, objetivos, relatórios, CSV.
- Gráficos com paleta validada para daltonismo, tooltips acessíveis por teclado e vista em tabela.
- Registo rápido global (tecla N) e animações discretas (respeitam "reduzir movimento").
- Correções encontradas pelos E2E: formulários perdiam o que foi escrito após erro (React 19); IDs de campos duplicados; valores dos KPIs invisíveis a leitores de ecrã; mensagem de sucesso desatualizada; números negativos tratados como texto no CSV.

## [0.1.0] — 15/11/2026 · Fase 1: Fundação

### Adicionado
- Monorepo com `apps/web` e os pacotes `financial-engine`, `validation`, `i18n`, `types`, `ui`, `database` e `config`.
- Motor financeiro com decimal exato (`bigint`), `Money` por moeda, arredondamentos (half-up, half-even, down, up), repartição sem perda de cêntimos, e fórmulas de custo total, lucro bruto, resultado operacional, margem, markup e preço a partir de margem ou markup.
- Validação de NIF/NIPC, CPF e CNPJ (incluindo o alfanumérico), no servidor web e no Postgres.
- Migrations Supabase: dados de referência (PT, BR, regiões fiscais e estados), perfis, preferências, organizações, RBAC com hierarquia, convites com token em hash, auditoria, administração da plataforma, feature flags e definições.
- RPC de organização, convites, membros e funções, com regras anti-escalada.
- App web com registo, login, recuperação de palavra-passe, verificação de email, Google (opcional), onboarding, troca de contexto, painel, organização, membros, funções, definições e aceitação de convite.
- Interface em pt-PT e pt-BR, com tema escuro ANEN.
- Cabeçalhos de segurança e CI no GitHub Actions.
- 75 testes automáticos, incluindo 26 de RLS e acessos cruzados.

### Alterado
- O produto deixa de ser um app de financiamento a empresas e passa a ser a plataforma de finanças, orçamentos e serviços. O `CLAUDE.md` foi reescrito.
- Nova paleta e logótipo recolorido para fundo escuro.
