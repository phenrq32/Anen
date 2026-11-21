# Changelog

## [0.9.0] · 21/11/2026 · Prompt 03, Fase 4: descontos, produto/serviço, descrição do projeto
- Desconto comercial no orçamento, em percentagem ou valor fixo (um dos dois, validado na base de dados). Aplica-se ao preço sem imposto, depois da margem; o imposto incide sobre o valor descontado. O motor recusa um desconto fixo maior do que o preço e assinala quando o desconto deixa o preço abaixo do custo.
- Cada linha diz se vende um produto ou um serviço (sugerido pelo tipo de custo: material e equipamento são produtos; o utilizador pode mudar). O editor e o documento para o cliente mostram os totais de produtos e de serviços.
- Documento para o cliente: coluna produto/serviço, subtotal, desconto (com a %) e só depois o imposto. A repartição do preço pelas linhas passou para o motor (`allocateLinePrices`).
- Projetos com descrição (âmbito do trabalho), separada das notas. O projeto criado a partir de um orçamento copia a descrição, e a receita prevista é o preço já com desconto. Os projetos antigos criados de orçamentos receberam a descrição do orçamento.
- Editor de orçamentos: a descrição da linha passou para uma linha própria; a grelha anterior ficava sem espaço para a descrição em ecrãs de 1280 px.
- Migration 1200. Testes: 203 unitários, de motor e de RLS (`quote-discounts.test.ts`), e o E2E `quote-discounts.spec.ts`.

## [0.8.0] — 17/11/2026 · Prompt 03, Fase 3: CRM
- Observações datadas na ficha do contacto (nota, chamada, reunião, email, visita): `contact_notes`, com RLS por `business.*`, o contacto sempre do mesmo âmbito e sem poder ser trocado.
- Histórico de preços por fornecedor (`supplier_prices`): artigo, unidade, preço unitário, moeda e data, com ligação opcional à despesa que o comprova (mesmo fornecedor, mesma moeda, validado na base de dados). Só fornecedores. Sem preços de mercado: só o que o utilizador regista.
- Motor `summarizePriceHistory`: agrupa por artigo (nome normalizado + unidade + moeda), com último preço, anterior, variação em valor e em %, mínimo e máximo. Não mistura moedas nem unidades.
- Orçamentos ligados ao cadastro (`quotes.client_contact_id`): no editor escolhe-se o cliente e os dados são preenchidos. A ligação fica bloqueada depois de aceite. O projeto criado a partir do orçamento usa o cliente ligado e só procura pelo nome quando não há ligação. Os orçamentos que já tinham um projeto com cliente foram ligados (um facto, não uma suposição pelo nome).
- Ficha do contacto: pendentes ordenados por vencimento (com vencidos assinalados), orçamentos do cliente, histórico de observações e de preços.
- Migration 1100 aplicada em produção; 20 E2E a passar em produção (desktop e telemóvel), incluindo `crm.spec.ts`.

## [0.7.0] — 16/11/2026 · Prompt 03, Fase 2: recorrentes completos e anexos
- Recorrentes editáveis (valor, descrição, categoria, fim e ligações). A frequência e o início ficam fixos, também na base de dados.
- Recorrentes com cliente/fornecedor, projeto, centro de custo e tipo de custo, opção "gerar como pendente" e vencimento N dias após cada ocorrência. Os movimentos gerados herdam tudo (no servidor e na aplicação).
- `materialize_recurring` passa a `SECURITY DEFINER` com verificação explícita de escrita (o calendário deixou de ser editável pelos clientes) e não gera movimentos futuros.
- Anexos de faturas e recibos: bucket privado `attachments` (PDF/imagem, até 10 MB), registo `transaction_attachments` com âmbito herdado do movimento, políticas de Storage pelo âmbito. O envio vai direto do browser por URL assinado (sem o limite de tamanho das funções) e a abertura usa um URL assinado de 60 s. Apagar o movimento remove os ficheiros.
- Correções de layout encontradas pelos E2E: no telemóvel, a linha de movimento com etiquetas ultrapassava o ecrã e escondia "Eliminar"; no desktop, os separadores de Finanças alargavam a página (grelha `1fr` → `minmax(0,1fr)`).

## [0.6.0] — 16/11/2026 · Prompt 03, Fase 1: auditoria e tarefas no servidor
- `CURRENT_IMPLEMENTATION_AUDIT.md`: páginas, o que funciona, o que é parcial, o que não existe e os problemas técnicos. Não foram encontrados dados fictícios, botões sem ação nem formulários que só simulam.
- Tarefas no servidor com `pg_cron` (diária, 05:00 UTC): os recorrentes passam a ser gerados para todas as pessoas e organizações sem ninguém abrir a aplicação. Cada recorrência é isolada (uma falha não trava as outras), é idempotente e mantém o autor.
- Registo de execuções `job_runs` (estado, quantidade, falhas, detalhe), legível só por administradores da plataforma.
- Removidos textos de tradução obsoletos.

## [0.5.0] — 16/11/2026 · Plano do mês (finanças pessoais)
- Salário líquido do mês e reserva de emergência já guardada, por mês (pré-preenchidos com o último plano).
- Despesas fixas com o valor editável no próprio lugar; total e percentagem do salário.
- Sobra ou défice do mês. Em défice: maiores despesas e passos para equilibrar. Com sobra: repartição entre reserva de emergência e longo prazo (motor `computeMonthlyPlan`, regras explicadas na página), orientação adaptada ao tamanho da sobra e projeção sem rendimentos (1, 5 e 10 anos).
- Catálogo `investment_options` por país (PT e BR), com risco, acesso ao dinheiro, fonte oficial e data de revisão. Sem taxas de rendimento: a página aponta para a fonte onde se confirmam as condições atuais. Aviso de orientação educativa.
- Migrations 0700 e 0800 aplicadas em produção e web publicada; 16 E2E a passar em produção (desktop e telemóvel).
- Projetos sem orçamento de origem mostram "—" no previsto e no desvio por tipo, em vez de um desvio enganador.

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
