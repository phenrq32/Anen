# ANEN · Prompt mestre 02: auditoria e plano de expansão

_16/11/2026. Ponto de partida: commit `a4414b0` (fases 1–3 do prompt mestre 01 em produção)._

## 1. Auditoria

### O que existe e funciona (testado)

| Área | Estado | Notas |
|---|---|---|
| Identidade, organizações, RBAC, convites, auditoria | Testado | RLS por `has_org_permission`, 26 testes de acessos cruzados |
| Contas financeiras, receitas, despesas, categorias, recorrentes | Testado | Dinheiro em `bigint`, moeda copiada da conta, recorrentes idempotentes |
| Orçamentos mensais por categoria, objetivos de poupança | Testado / Implementado | |
| Resumo financeiro (KPIs, 12 meses, por categoria) e exportação CSV | Testado | |
| Orçamentos a clientes (motor, versões imutáveis, estados, impressão) | Testado | `@anen/financial-engine/quote` |
| Fichas técnicas de restauração (food cost, preço recomendado, histórico) | Testado | Preços de ingredientes introduzidos à mão |

### Parcialmente funcional

| Área | Falta |
|---|---|
| Despesas | Sem vencimento, estado de pagamento, impostos separados, fornecedor, projeto, centro de custo, método de pagamento nem comprovativo. Todas as despesas contam como pagas. |
| Receitas | Sem cliente, sem projeto, sem pagamentos parciais nem valores pendentes. |
| Orçamentos a clientes | Um orçamento aceite não gera nada: não há projeto, por isso não há comparação entre previsto e real. |
| Contraparte | É texto livre (`counterparty`), sem cadastro de clientes nem de fornecedores. |
| Painel | Mostra só finanças. Não tem valores a receber ou a pagar nem projetos. |

### Inexistente

ANEN AI, monitorização de preços de mercado, compras e fornecedores, inventário, notificações, automações, tarefas agendadas no servidor, limites por plano, painel administrativo e motor fiscal.

### Problemas arquiteturais encontrados

1. **Não há tarefas no servidor.** Os recorrentes só se geram quando alguém abre a página (`materializeDue`). A monitorização de preços, os alertas e os resumos da IA precisam de um agendador que não dependa do browser. Proposta: `pg_cron` no Supabase a chamar funções SQL e Edge Functions, com uma tabela `job_runs` para registar execuções, erros e tentativas.
2. **A chave `service_role` não é usada em lado nenhum.** Os jobs vão precisar dela, só em Edge Functions, nunca na app web.
3. **Os tipos são mantidos à mão** (`packages/types/src/database.ts`). Isto aguenta enquanto o esquema crescer pouco. Convém passar a `supabase gen types` quando houver CI.
4. **Os relatórios contam tudo como pago.** Com despesas pendentes, o saldo e o fluxo de caixa passam a contar só o valor efetivamente liquidado.
5. **Identidade visual.** O prompt 02 acrescenta `#141414` (preto secundário) e `#A0A0A0` (cinza secundário). Os tokens atuais já seguem a mesma linha e só precisam de um ajuste. A imagem de referência mencionada no prompt **não foi enviada** nesta conversa.

## 2. Dependências externas (o que bloqueia o quê)

| Funcionalidade | Precisa de | Sem isso |
|---|---|---|
| ANEN AI (chat, resumos, recomendações) | Chave de API de um modelo de linguagem (ex.: Anthropic) e um limite mensal de custo | Os motores determinísticos e os alertas por regras funcionam. A UI explica que a IA não está ligada. |
| Preços de mercado automáticos | Fontes com API ou licença: catálogos de fornecedores, marketplaces com API, INE, Eurostat, IBGE/SINAPI | Funcionam os preços observados pelo próprio utilizador (compras, cotações e introdução manual), com histórico e alertas. Nada é apresentado como "preço de mercado" sem fonte. |
| Notificações por email | SMTP ou fornecedor de email (Resend, Postmark…) | Ficam só na aplicação |
| Push | Conta Expo/FCM/APNs (Fase 9 do prompt 01) | Só na aplicação |
| OCR de faturas | Fornecedor de OCR, ou IA com visão | Upload manual do comprovativo |
| Open Banking | Agregador licenciado (PSD2 em PT, Open Finance no BR) | Importação de extrato CSV |
| Planos pagos | Stripe (ou equivalente) e preços | Limites configuráveis, mas sem cobrança |
| Fiscalidade | Validação contabilística das taxas | Taxa indicada pelo utilizador, marcada como tal |
| `pg_cron` em produção | Ativar a extensão no projeto Supabase (o plano gratuito permite) | Ativo nesta expansão |

## 3. Plano de execução

Mantém-se a ordem do prompt 02. Cada fase termina com testes (unitários, RLS e E2E), documentação, `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md` e publicação.

### Fase A: integração financeira (fases 1, 2 e parte da 7 do prompt 02). **Em curso.**

Modelo de dados (migration `0700_business_core`):
- `contacts`: clientes e fornecedores, com NIF/CPF/CNPJ, email, telefone, morada, prazo de pagamento e notas. Âmbito pessoal ou de organização.
- `cost_centers`: centros de custo.
- `projects`: nome, cliente, orçamento de origem (único), estado (`planned`, `active`, `completed`, `cancelled`), moeda, custo e receita previstos, datas.
- `transactions` passa a ter: `contact_id`, `project_id`, `cost_center_id`, `cost_kind` (o mesmo vocabulário das linhas do orçamento: material, mão de obra, deslocação, equipamento, indiretos, outro), `due_on`, `net_minor` e `tax_minor` (opcionais, com `net + tax = total`), `settled_minor` (valor pago ou recebido; o estado `pending`, `partial` ou `paid` é derivado), `payment_method` e `document_ref`.
- Integridade: contacto, projeto e centro de custo têm de ser do mesmo âmbito do movimento, e o projeto tem de estar na mesma moeda. Não se mistura moeda.
- RPC `create_project_from_quote`: só para orçamentos aceites. Copia o custo e a receita previstos e liga (ou cria) o cliente.
- Saldos, resumo mensal e por categoria passam a usar o valor liquidado (caixa). Os pendentes aparecem em "A receber / A pagar".
- Nova permissão `business.read` / `business.write`.

Motor (`@anen/financial-engine/project`): previsto vs. real por tipo de custo, desvio absoluto e percentual, lucro previsto vs. real, margem real e alerta de ultrapassagem. É determinístico e testado. A IA vai usá-lo mais tarde.

Interface: Contactos (lista, ficha com histórico), Projetos (lista, ficha com previsto vs. real e movimentos), "A receber / A pagar" com vencidos e ação "marcar como pago", formulário de movimento com "mais detalhes", botão "Criar projeto" num orçamento aceite e indicadores novos no painel.

### Fase B: compras e fornecedores (fase 5)
Pedidos de cotação, propostas, encomendas, receção e comparação pelo custo total (unitário + transporte + impostos + prazo). Ao receber uma encomenda, gera-se a despesa associada ao projeto.

### Fase C: preços observados e monitorização (fase 4)
`price_sources` (com licença, frequência permitida e estado), `price_items` (produto normalizado: unidade-base e conversões), `price_observations` (preço, moeda, unidade, impostos, transporte, fonte, URL, data de recolha, confiança), `price_watches` e `price_alerts`. As fontes iniciais são legítimas e já existem: compras registadas, cotações recebidas e introdução manual. As fontes externas entram por adaptadores, um por fonte, com limite de pedidos e cache, quando houver contrato ou API. Agendamento por `pg_cron` e `job_runs`. Painel de inteligência de mercado.

### Fase D: inventário (fase 6)
Produtos, movimentos de stock, custo médio ponderado, lotes, validade, perdas e stock mínimo. A receção de compras alimenta o stock.

### Fase E: orçamentos inteligentes e restauração (fases 7 e 8)
Sugestão de custos a partir dos preços observados, sempre editável e com a fonte e a data à vista. Margem vs. markup explícitos. Impacto da variação de um ingrediente nas fichas técnicas.

### Fase F: ANEN AI (fase 3). **Bloqueada pela chave de API.**
Serviço no servidor com ferramentas tipadas (consultar movimentos, totais, projetos, preços) que chamam as funções determinísticas. As respostas citam os registos usados. Os pedidos ficam registados com o custo, há limite por plano e a IA não executa ações financeiras sem confirmação.

### Fase G: painel, notificações e automações (fase 9)
Centro de notificações, regras configuráveis com registo de execução e filtros de período no painel.

### Fase H: monetização, administração e saúde (fases 10, 14 e 15)
Limites por plano em dados e validados no servidor, painel de administração, saúde dos jobs e custos de API.
