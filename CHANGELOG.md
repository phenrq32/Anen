# Changelog

## [0.26.0] · 23/11/2026 · Dual Workspace, Fase 4: seletor de contexto e navegação adaptativa
- Menu por workspace (QA-04): no pessoal saem os módulos de empresa sem dados pessoais; numa organização, as áreas sem permissão de leitura. As Áreas do menu explicam a regra no pessoal.
- Convites pendentes no seletor, aceites sem o link (migration 2900: `my_invitations`, `accept_my_invitation`).
- Abas sincronizadas: BroadcastChannel e `/api/workspace` ao voltar à aba; o estado do cliente recomeça ao mudar de workspace.
- Fase 3 publicada (migration 2800 e deploy). Corrigida uma corrida nos E2E de duas abas. Registados QA-14 (checkout InfinitePay em produção) e QA-15 (erro genérico numa falha da IA).
- Testes: 462 unitários; E2E `workspace-nav.spec.ts`; `review-settings.spec.ts` adaptado.
- Publicado em produção a 23/11/2026 (migration 2900 aplicada antes); 14 E2E a passar contra o site, incluindo o convite aceite no seletor.

## [0.25.0] · 23/11/2026 · Dual Workspace, Fase 3: separação dos dados e segurança no servidor
- Uma gravação só acontece no workspace que estava no ecrã (QA-03). Os formulários enviam `__workspace` (automático em `ActionForm` e `InlineAction`), 78 ações começam por `guardWorkspace` com falha fechada, e o painel avisa quando nada foi gravado.
- Migration 2800: gatilho `workspace_immutable` em todas as tabelas com âmbito (uma regra única em vez de uma por tabela) e auditoria de recorrências, anexos, orçamentos mensais e objetivos.
- A importação de extratos usa só as categorias do workspace ativo (QA-05). Concluir um anexo filtra pelo workspace ativo.
- Testes: 452 unitários (`isolation.test.ts`, `workspace-guard-coverage.test.ts`, `checkWorkspaceKey`); E2E `workspace-guard.spec.ts` (duas abas); corrigida uma corrida em `income-period.spec.ts`. Documentação: `TESTING_DUAL_WORKSPACES.md`.

## [0.24.1] · 23/11/2026 · Estado do pagamento visível ao lançar
- "Estado do pagamento" sempre visível ao lançar, também no registo rápido. Despesa: Já pago / Por pagar / Pago em parte. Receita: Já recebido / Por receber / Recebido em parte. O vencimento aparece quando falta pagar. Antes, a opção estava escondida em "Mais detalhes" e não existia no registo rápido (QA-06).
- A ação trata o estado do pagamento à parte dos detalhes: o registo rápido não apaga contacto, projeto nem imposto, e um movimento pago mantém o vencimento.
- Testes: 429 unitários; E2E `open-items` alargado (registo rápido por pagar).
- Publicado em produção a 23/11/2026, com a migration 2700 aplicada antes; `open-items` e `finance` passam contra o site publicado.

## [0.24.0] · 23/11/2026 · Dual Workspace, Fase 2: workspaces, conta única e membros
- Migration 2700 (só acrescenta, não altera dados): vistas só de leitura `workspaces` (o pessoal e as organizações de que a pessoa é membro ativo) e `workspace_members`; `can_access_workspace`; `ensure_personal_workspace` (idempotente).
- `lib/workspace.ts`: workspace ativo, âmbito por módulo, lista, chave de cache e resolução que recusa organizações de que a pessoa não é membro. `financeScope`, `businessScope` e `quotesScope` passam a derivar daqui.
- A sessão repõe o espaço pessoal de uma conta a que falte, em vez de a mandar para o login. Uma falha ao mudar de contexto passa a ser mostrada (QA-07).
- Documentação: `DUAL_ARCHITECTURE.md`, `WORKSPACE_DATA_MODEL.md`, `DATABASE_SCHEMA.md`.
- Testes: 429 unitários (`workspaces.test.ts` com 14, `workspace.test.ts` com 6); 14 E2E a passar (contas, finanças, empresa, a receber e a pagar, notificações), em desktop e telemóvel.

## [0.23.0] · 23/11/2026 · Dual Workspace, Fase 1: auditoria, revisão e "A receber e a pagar"
- "A receber e a pagar": formulário próprio na página (já como pendente; Receita é a receber, Despesa é a pagar; `?tipo=income`), e "Editar" e "Eliminar" em cada linha. Sem nenhuma conta, a página leva a criar uma. Antes só se criava um valor em aberto em Movimentos → Mais detalhes, e só se editava no mês selecionado.
- Eliminar um movimento confirma primeiro que ele é do contexto ativo; só então remove os anexos do Storage e o movimento. Remover um anexo também passou a filtrar pelo contexto ativo.
- Novos `DUAL_ARCHITECTURE_AUDIT.md` (auditoria, zona visual protegida, decisão para a Fase 2) e `QA_REVIEW.md` (12 problemas, com gravidade e estado).
- Testes: 409 unitários (`open-items.test.ts`, 16 testes com acessos cruzados); E2E novo `open-items.spec.ts` e `recurring-attachments.spec.ts` alargado (o ficheiro sai do Storage ao eliminar o movimento), com `storageObjectExists` em `e2e/admin.ts`. 10 E2E a passar (desktop e telemóvel).

## [0.22.0] · 23/11/2026 · App instalável, notificações push, importador e mais
- App instalável (PWA, grátis, sem lojas): manifesto com atalhos, ícones (incluindo adaptável e iPhone), service worker que nunca guarda páginas nem dados no aparelho (só ficheiros públicos), página "sem ligação", botão "Instalar" (Android/computador) e passos para o iPhone, no painel e em Definições → App no telemóvel.
- Notificações push: inscrição por aparelho (`push_subscriptions`), envio diário às 07:15 UTC pela rotina `/api/push/dispatch` (Vercel Cron) com um segredo próprio que só dá acesso a `push_claim_batch`/`push_report` (sem chave de serviço no servidor), notificação de teste. Migration 2400.
- Importar extrato (CSV/OFX) com pré-visualização, categorias lembradas e sem duplicados (`import_ref`, migration 2300). Memória de categorias também no registo rápido.
- Apagar a conta, sair e apagar organização, apagar notificações (migration 2200). Vidro, holofote e reflexos na interface. Tema rosa claro. Barra fixa do orçamento no telemóvel, atalhos nas Definições.
- Testes: 381 unitários; E2E novos `bank-import`, `danger-zone`, `pwa`.

## [0.21.0] · 23/11/2026 · Revisão: apagar orçamentos, acessibilidade e áreas do menu
- Orçamentos: apagam-se em qualquer estado (antes só os rascunhos, e o botão só aparecia dentro do orçamento com o nome "Eliminar movimento"). Na lista há seleção com "Selecionar todos" e "Apagar selecionados"; a confirmação explica que linhas e histórico também vão e que faturas e projetos ligados ficam sem a ligação.
- Definições → Acessibilidade (por aparelho, cookie anen-a11y aplicado no <html> pelo servidor): reduzir animações, alto contraste (escuro e claro), sublinhar ligações, destaque forte do foco do teclado, mais espaço no texto e letra de leitura fácil (Atkinson Hyperlegible, descarregada só por quem a liga).
- Definições → Áreas do menu (`user_preferences.hidden_modules`, na conta): esconder orçamentos, faturação, projetos, compras, inventário, fichas técnicas, IA, inteligência, relatórios ou mercado do menu, da barra do telemóvel e da procura. As páginas e os dados ficam. As fichas técnicas vêm escondidas por omissão, exceto para quem já as usa.
- Migration 2100. Testes: 358 unitários (`a11y.test.ts`, `modules.test.ts`, exclusão de orçamentos em `quotes.test.ts`, `rls.test.ts`) e o E2E `review-settings.spec.ts`; 44 E2E em produção.

## [0.20.0] · 22/11/2026 · Lotes, validades e produção pelas fichas técnicas
- Inventário: cada entrada cria um lote (código e validade opcionais). Saídas, perdas e contagens para baixo gastam primeiro o que vence antes (FEFO); os lotes sem validade ficam para o fim. Nas saídas e perdas pode escolher-se o lote. A contagem acima do saldo cria um lote de acerto. Fica registado quanto cada movimento tirou de cada lote. Saldos que já existiam viram um lote "saldo anterior". Faturas, compras e anulações passam pelo mesmo gatilho, por isso também respeitam os lotes.
- Página do artigo: tabela de lotes com validade, "vencido", "vence hoje" e "vence em N dias"; lotes esgotados à parte. Lista do inventário: lotes a vencer em 7 dias e vencidos com stock.
- Fichas técnicas: cada ingrediente pode ligar-se a um artigo do stock (aviso se a unidade não converte). "Registar produção" dá saída dos ingredientes ligados, com o desperdício e a conversão de unidades, tudo ou nada; histórico das produções na ficha e o nome da produção nos movimentos.
- Notificações: lotes a vencer (antecedência de 1 a 60 dias, por omissão 7) e lotes vencidos com stock.
- Migration 2000. Testes: 352 unitários (`stock-lots.test.ts`, incluindo a paridade das conversões de unidades entre o motor e a base de dados) e o E2E `stock-lots.spec.ts`.

## [0.19.0] · 22/11/2026 · Período no painel
- Painel: escolha do período dos totais (Este mês, 3 meses, 12 meses, em `?periodo=`). Receitas, despesas, resultado e margem somam o período e comparam com o período anterior do mesmo tamanho. O gráfico continua a mostrar 12 meses e a nota de saúde financeira continua a ser do mês atual.
- Uma só consulta de 24 meses (`finance_monthly`) alimenta o gráfico e as comparações; soma em `bigint` (`dashboard-period.ts`).
- Testes: 334 unitários (`dashboard-period.test.ts`) e o E2E `dashboard-period.spec.ts`.

## [0.18.0] · 22/11/2026 · Aparência e tour de boas-vindas
- Definições → Aparência: tema Escuro, Claro ou Automático (segue o aparelho) e texto Normal, Grande ou Muito grande (amplia letras, botões e espaços por igual). Muda na hora e fica guardado no aparelho (cookies anen-theme/anen-text); o servidor já desenha a página com a escolha, sem piscar. Atalho na procura (Ctrl+K).
- Tema claro só troca as variáveis de cor: o texto sobre o laranja continua preto (cor nova on-brand) e o texto laranja passa a laranja-escuro para ter contraste sobre branco (regra da marca).
- Tour de boas-vindas na 1ª visita ao painel: destaca a nota de saúde financeira, os atalhos, o botão Registar, a procura (ou "Mais" no telemóvel), os alertas e onde mudar a aparência. Pular, Voltar, Próximo, setas e Esc; tocar fora não fecha; passos sem o elemento na tela são saltados. Pode ser visto de novo em Definições.
- Testes: 328 unitários (appearance.test.ts garante que toda cor do tema escuro tem par no claro) e o E2E appearance-tour.spec.ts.

## [0.17.0] · 22/11/2026 · Interface nova e mais rápida
- Velocidade: as funções da Vercel passam a correr em Dublin (dub1), junto da base de dados (Supabase eu-west-1); antes corriam em Washington (iad1) e cada consulta atravessava o Atlântico. O layout e o painel fazem as consultas em paralelo. Barra de progresso instantânea ao mudar de página.
- Navegação: menu agrupado (Dia a dia, Negócio, Análise, Conta) com ícones maiores e alvos de 44 px; no telemóvel, barra inferior fixa (Painel, Finanças, Registar, ANEN AI, Mais) com gaveta de todas as áreas; procura e comandos com Ctrl+K ou "/".
- Painel: saudação pela hora do dia, nota de saúde financeira animada (motor health.ts: poupança 40, reserva 30, contas em dia 30, com a explicação), atalhos grandes e as 3 recomendações mais importantes do centro de inteligência.
- Movimento: brilho ambiente suave, cartões que reagem ao toque, entradas em cascata, esqueletos com reflexo, gaveta e procura animadas, botões com retorno ao clique. Tudo desliga com "reduzir movimento" do sistema.
- Testes: 324 unitários (health.test.ts).

## [0.16.0] · 22/11/2026 · Centro de inteligência
- `/inteligencia` (todos os planos): recomendações determinísticas dos últimos 7 ou 30 dias, comparadas com o período anterior do mesmo tamanho. Cada uma diz o que foi identificado, os valores que a sustentam, o impacto, a prioridade, o grau de confiança e uma ligação para agir.
- Regras (motor `intelligence.ts`): despesas acima das receitas; receitas a cair 20 % ou mais; despesas por categoria a subir 20 % ou mais (máximo 3); valores por receber e pagamentos em atraso; pagamentos nos próximos 7 dias; possíveis duplicados (confiança média); stock abaixo do mínimo; projetos acima do orçamento; preços de fornecedores a subir 5 % ou mais; aviso quando não há movimentos. As recomendações respeitam as permissões da pessoa.
- Resumo da ANEN AI (Pro e Max): gerado a pedido com as ferramentas da IA, com fontes, e guardado por pessoa, contexto, período e dia (`ai_digests`), para voltar à página sem gastar outra pergunta. Gasta 1 pergunta do limite diário.
- Migration 1900. Testes: 318 unitários (`intelligence.test.ts`, `ai-digests.test.ts`) e o E2E `intelligence.spec.ts`.

## [0.15.0] · 22/11/2026 · Faturação certificada em Portugal (InvoiceXpress)
- A ANEN não é um programa certificado pela AT: os documentos fiscais são emitidos pelo InvoiceXpress (certificado n.º 192) na conta de cada cliente, que numera, assina, gera ATCUD e QR, comunica à AT e devolve o código AT das guias. A página diz isto claramente.
- Cada cliente liga a sua conta (nome da conta + chave da API, validados no InvoiceXpress). A chave fica cifrada (AES-256-GCM) com uma chave mestra que só existe no servidor.
- `/faturacao`: fatura, fatura-recibo, fatura simplificada, guia de transporte e guia de remessa. Cria em rascunho no InvoiceXpress, mostra a estimativa de totais e emite com confirmação. Nota de crédito a partir de uma fatura. Anulação com motivo. PDF oficial e envio por email pelo InvoiceXpress. Atualização do código AT das guias.
- Integração: emitir cria o valor a receber (fatura) ou recebido (fatura-recibo e simplificada) nas finanças, com IVA separado e referência do documento, dá baixa no stock das linhas ligadas a artigos e liga ao projeto; anular remove o valor ainda não recebido e devolve o stock. Botão "Faturar" nos orçamentos aceites. Local de carga por omissão nas guias.
- IVA a 0 % exige o motivo de isenção (códigos M da AT). NIF português validado.
- Migration 1800. Testes: 305 unitários (`invoicexpress.test.ts`, `invoicing.test.ts`, validação) e o E2E `invoicing.spec.ts` contra o InvoiceXpress real (chave recusada).

## [0.14.0] · 22/11/2026 · ANEN AI e planos Free, Pro e Max
- Planos em dados (`plans`): Free sem IA, Pro com 25 perguntas por dia e Max com 100, por conta (pessoal ou organização), no fuso da conta. Limites editáveis pelos administradores da plataforma, sem mudar código. Subscrição por âmbito (`subscriptions`), atribuída por administradores até haver cobrança.
- ANEN AI (`/ia`), pedida para os planos de preço médio e mais caro: conversas privadas por pessoa e contexto, consentimento antes do primeiro uso, contador de perguntas e sugestões de perguntas.
- A IA só responde com dados das ferramentas, que correm com as permissões da pessoa (RLS) e calculam com o motor: resumo financeiro, comparação de períodos, valores em aberto, despesas duplicadas, rentabilidade de projetos, preços de fornecedores, reposição de stock, receita necessária para um lucro e orçamentos. As fontes de cada resposta vêm das ferramentas, não do modelo.
- Limite aplicado no servidor (`ai_begin_request`, com trava): a pergunta é reservada antes de chamar o modelo e devolvida se o fornecedor falhar.
- Fornecedor: Google Gemini por REST, isolado em `lib/ai/gemini.ts`, com recurso automático entre modelos quando um está sobrecarregado (3.5 Flash → 3.8 Flash → 3.5 Flash-Lite; `GEMINI_MODELS`). A chave fica só nas variáveis de ambiente (`GEMINI_API_KEY`).
- Motor `insights.ts`: despesas possivelmente duplicadas, variação por categoria e receita necessária para um lucro.
- Migration 1700. Testes: 289 unitários (`plans-ai.test.ts`, `insights.test.ts`, `gemini.test.ts`) e o E2E `ai.spec.ts`, em produção com o modelo real.

## [0.13.0] · 21/11/2026 · Prompt 03, Fase 9: notificações, relatórios e otimização
- Notificações na aplicação (`/notificacoes`): pagamentos e recebimentos vencidos e a vencer, stock abaixo do mínimo (uma vez por episódio), encomendas atrasadas e alertas do agente de mercado. Cada pessoa recebe as das organizações onde tem a permissão do tipo; ao perder a permissão, deixa de as ver.
- Geração no servidor, sem repetições: tarefa diária `anen-notifications` (06:45 UTC, registada em `job_runs`, com limpeza das antigas) e atualização ao abrir a página. "Abrir" marca como lida e muda para o contexto da notificação (pessoal ou organização).
- Preferências por pessoa: que tipos receber e com quantos dias de antecedência avisar os pagamentos. Contador de não lidas no menu.
- Email e push ainda não: a página diz isso. Ficam disponíveis quando houver um serviço de envio.
- Relatórios (`/relatorios`): este mês, mês anterior, trimestre, ano, ano anterior ou intervalo personalizado (até 5 anos). Receitas, despesas, resultado e valor por liquidar, faturado e liquidado; por mês, categoria, cliente ou fornecedor, projeto e centro de custo; exportação CSV de cada quadro. Sem permissão de negócio, os nomes não aparecem.
- Motor `report.ts`: períodos e leitura das linhas, sem ponto flutuante. A proteção contra fórmulas nos CSV passou para `lib/csv.ts`.
- Otimização: índices para relatórios por contacto e projeto, encomendas atrasadas, stock com mínimo e notificações por ler.
- Migration 1600. Testes: 273 unitários (`report.test.ts`, `notifications.test.ts`) e o E2E `notifications-reports.spec.ts`.

## [0.12.0] · 21/11/2026 · Prompt 03, Fase 8: compras, inventário e reposição
- Inventário (`/inventario`): artigos com unidade, moeda, stock mínimo, nível de reposição e fornecedor habitual. O saldo e o custo médio ponderado são calculados no servidor, com o artigo bloqueado durante o cálculo. Os movimentos (entrada, saída, perda e contagem) não se editam nem se apagam: a correção é uma contagem. Não há saldo negativo.
- Motor `stock.ts`: `applyStockMovement` (o mesmo cálculo do servidor; os testes comparam os dois passo a passo), `stockValue`, `isBelowMinimum` e `compareSupplierPrices`.
- Compras (`/compras`): encomendas a fornecedores com linhas ligadas (ou não) a artigos de stock, total calculado no servidor, estados rascunho → encomendada → recebida ou cancelada, e projeto opcional.
- Receção (`receive_purchase_order`): numa só transação, cria as entradas de stock ao preço da linha, os preços no histórico do fornecedor e, com uma conta, a despesa (paga, ou a pagar com vencimento pelo prazo do fornecedor). Sem permissão de finanças, recebe-se sem despesa.
- Reposição: lista do que está abaixo do mínimo, descontando o que já está encomendado, e rascunhos de encomenda por fornecedor com o último preço pago (zero quando não há compras, assinalado como "Sem preço").
- Comparação do mesmo artigo (nome, unidade e moeda) entre fornecedores, a partir dos preços registados e das compras recebidas.
- Correção: os campos `numeric` chegam do PostgREST como números JSON (nos testes com PGlite chegam como texto); o tipo passa a `string | number` e a página converte o valor antes de o passar ao motor.
- Menu com Compras e Inventário (Estoque em pt-BR).
- Migration 1500. Testes: 260 unitários, de motor, de validação e de base de dados (`inventory.test.ts`: RLS, acessos cruzados, imutabilidade, receção, reposição e apagamento de conta), e o E2E `purchases-inventory.spec.ts`.

## [0.11.1] · 21/11/2026 · Publicação das fases 4, 5 e 6
- Migrations 1200, 1300 e 1400 aplicadas em produção. Extensão `http` instalada; o agente de mercado correu uma vez com sucesso (36 séries, 864 observações) e está agendado (`anen-market-agent`, 06:30 UTC).
- Correção: a barra lateral no computador não deslizava. Numa organização, com ecrãs de 720 px de altura, "Terminar sessão" ficava fora do ecrã. A navegação passa a deslizar e o rodapé fica sempre visível.
- E2E: as expressões dos testes aceitam o espaço não separável do `Intl` e o formato pt-PT ("2005,57 R$/m²"). 26 E2E a passar em produção.

## [0.11.0] · 21/11/2026 · Prompt 03, Fase 6: inteligência de mercado e agente de mercado
- Fontes oficiais e abertas, sem chave, verificadas a 21/11/2026: Eurostat HICP (Portugal, ECOICOP v2, índice 2025 = 100 e taxas mensal e anual), IBGE IPCA (tabela 7060, variações mensal e em 12 meses) e IBGE SINAPI (tabela 2296, custo médio do m² em R$). 36 séries: geral, alimentação (cereais, carne, peixe, laticínios, óleos, fruta, legumes, açúcar, café, farinhas, panificados…), restauração, eletricidade e gás, combustíveis e construção.
- Os preços de combustíveis por posto da DGEG não são usados: só existem numa API interna do site, sem documentação nem licença.
- Agente de mercado no Postgres: `private.run_market_agent()` recolhe cada série (extensão `http` da Supabase), guarda as observações tal como publicadas (`market_observations`, idempotente), regista a execução em `job_runs` e o estado de cada fonte. Uma série que falha não trava as outras. Agendado todos os dias às 06:30 UTC (`anen-market-agent`); os administradores da plataforma podem correr a pedido (`run_market_agent_now`). Os endereços vêm do catálogo, nunca do utilizador.
- Acompanhamento com limiar (`market_watches`, por pessoa ou organização, `business.*`) e alertas criados pelo agente quando a variação mensal publicada atinge o limiar (`market_alerts`, sem repetir; o leitor marca como lido).
- Motor: `compoundPercent` e `readMarketSeries` (último valor, anterior, acumulado de 3 meses consecutivos, sentido), sem ponto flutuante.
- Página `/mercado`: estado do agente e das fontes, alertas, Portugal e Brasil por categoria, acompanhar/deixar de acompanhar, fontes com licença e ligação.
- Migration 1400. Testes: 231 unitários, de motor (`market.test.ts`) e da base de dados com respostas reais gravadas das três fontes (`market.test.ts`, pasta `fixtures`), e o E2E `market.spec.ts`.

## [0.10.0] · 21/11/2026 · Prompt 03, Fase 5: fichas técnicas ligadas aos preços registados
- Cada ingrediente pode usar um preço registado de um fornecedor (`recipe_ingredients.supplier_price_id`). A lista mostra o preço mais recente de cada artigo por fornecedor, na moeda da ficha.
- Conversão de unidades no motor (`unitConversionFactor`: massa, volume e contagem, exata até 3 casas): um preço de 1,00 €/kg num ingrediente em gramas fica com 1000 g na embalagem. Sem conversão conhecida (ex.: "saco 25 kg"), a unidade do fornecedor passa para o ingrediente e o utilizador indica a correspondência.
- O preço usado fica como fotografia: o custo da ficha não muda sozinho. `recipe_price_updates` (SECURITY INVOKER) lista os ingredientes cujo artigo tem um preço mais recente no mesmo fornecedor, ou cujo registo foi corrigido. A ficha mostra o preço novo e o usado, com "Usar este preço" e "Atualizar todos"; a lista de fichas assinala "Preços novos". Cada gravação fica na evolução do custo.
- Segurança: o preço ligado tem de ser do mesmo âmbito e da mesma moeda (trigger). Uma ligação nova exige `business.read`; quem só tem `quotes.*` continua a gravar fichas com ligações já feitas, mas não vê os preços nem as atualizações. Apagar o preço do fornecedor desliga o ingrediente e mantém o preço usado.
- Editor de fichas: o nome e a origem do preço ficam numa linha, as quantidades e os preços noutra (a grelha antiga não cabia ao lado do resumo em ecrãs de 1280 px).
- Migration 1300. Testes: 215 unitários, de motor (`units.test.ts`) e de RLS (`recipe-prices.test.ts`), e o E2E `recipe-prices.spec.ts`.

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
