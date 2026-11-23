# Estado de implementação

Estados: Não iniciado · Em desenvolvimento · Implementado · Testado · Aprovado · Bloqueado.
"Testado" = coberto por testes automáticos que passam (unitários/RLS e E2E em produção). "Aprovado" exige validação humana, e nada está aprovado ainda.

_Atualizado em 23/11/2026 (Dual Workspace, Fase 5, parte 1)._ Produção: **https://anen-five.vercel.app** (Vercel + Supabase eu-west-1).

## Fase 1: Fundação

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Auditoria, arquitetura e monorepo | Implementado | `PROJECT_AUDIT.md`, `ARCHITECTURE.md` |
| Registo, login, recuperação, verificação de email | Testado | E2E em produção (desktop e mobile) |
| Login Google | Implementado | Desativado até configurar o provider |
| Onboarding (tipo de conta, país, idioma, moeda, fuso) | Testado | E2E |
| Organizações, RBAC, hierarquia, convites, auditoria | Testado | 26 testes de RLS + E2E de convite e aceitação |
| Alternar contexto pessoal / organização | Testado | RLS e E2E |
| Design system e estados de carregamento, vazio, erro e sucesso | Implementado | `packages/ui`, `components/*` |
| Apagamento de conta (RGPD/LGPD) | Testado | `erasure.test.ts` (bug encontrado e corrigido na migration 0600) |

## Fase 2: Finanças

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Contas (saldo inicial, arquivo, moeda bloqueada com movimentos) | Testado | RLS + E2E |
| Receitas e despesas, categorias de sistema e personalizadas | Testado | RLS + E2E |
| Registo rápido global (botão e tecla N) | Testado | E2E |
| Movimentos recorrentes (idempotentes, fim de mês, sem ressuscitar apagados) | Testado | RLS (PGlite) |
| Orçamentos mensais por categoria, alerta de excesso | Testado | E2E |
| Objetivos de poupança (progresso e valor mensal necessário) | Implementado | — |
| Resumo: KPIs, gráfico de 12 meses, despesas por categoria, margem | Testado | E2E com valores exatos e acessíveis |
| Exportação CSV (protegida contra injeção de fórmulas) | Testado | E2E |
| Painel inicial com dados reais | Implementado | — |
| Multi-moeda sem conversão automática (aviso explícito) | Implementado | — |

## Fase 3: Orçamentos

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Motor de orçamentos (materiais, mão de obra, deslocação, equipamento, indiretos, margem, imposto) | Testado | `quote.test.ts` |
| 19 modelos por atividade + em branco (linhas sugeridas, sem preços inventados) | Implementado | Migration 0500 |
| Editor com cálculo ao vivo e recálculo no servidor | Testado | E2E |
| Numeração sequencial, versões imutáveis e histórico de estados | Testado | RLS + E2E |
| Bloqueio após aceite, recusado, expirado ou cancelado | Testado | RLS + E2E |
| Documento para cliente (imprimir/PDF, sem custos internos) | Testado | E2E |
| Fichas técnicas de restauração (desperdício, food cost, preço mínimo e recomendado, evolução do custo) | Testado | `quote.test.ts` + E2E |
| Taxa de imposto | Implementado | **Indicada pelo utilizador.** A validação fiscal automática é da Fase 5. |
| Assinatura digital do orçamento, envio por email | Não iniciado | Requer fornecedor de email |
| Assistente de IA para criar orçamentos | Não iniciado | Fase 6 |

## Prompt 02 · Fase A: integração financeira

Plano completo e dependências externas em [EXPANSION_PLAN.md](EXPANSION_PLAN.md).

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Clientes e fornecedores (cadastro, ficha com compras, vendas e em aberto) | Implementado | RLS em `business.test.ts`; E2E `business.spec.ts` em produção (desktop e telemóvel) |
| Centros de custo | Implementado | RLS em `business.test.ts` |
| Projetos (criar, editar, estado, eliminar) | Implementado | RLS + E2E em produção |
| Projeto a partir de orçamento aceite | Testado (BD) | `business.test.ts` (recusa não aceites, idempotente, cria cliente) |
| Despesas e receitas: contacto, projeto, centro de custo, tipo de custo, vencimento, imposto incluído, método de pagamento, n.º de documento | Testado (BD) | `business.test.ts` (âmbito, moeda do projeto, coerência do imposto) |
| Pagamentos pendentes e parciais; saldo e relatórios em base de caixa | Testado (BD) | `business.test.ts` |
| A receber e a pagar, vencidos, marcar como liquidado | Testado | E2E em produção |
| Registar, editar e eliminar valores na própria página "A receber e a pagar" (pessoal e organização); "Por pagar/Por receber" ao lançar, também no registo rápido | Testado (em produção) | `open-items.test.ts` (16, incluindo acessos cruzados); E2E `open-items.spec.ts` contra produção (desktop e telemóvel, 23/11/2026) |
| Previsto vs. real por projeto e por tipo de custo, alerta de ultrapassagem | Testado (motor) | `project.test.ts` (inclui o exemplo 300 € → 350 €) |
| Painel com valores em aberto, projetos e orçamentos recentes | Implementado | — |
| Comprovativo anexado (ficheiro) | Não iniciado | Supabase Storage com RLS; fica para a fase de compras |
| Ligações nos movimentos recorrentes | Não iniciado | Os recorrentes ainda não têm contacto nem projeto |

## Plano do mês (finanças pessoais)

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Salário do mês, reserva, despesas fixas editáveis | Testado (BD) | `monthly-plan.test.ts` (RLS, um plano por mês, apagamento); E2E `plan.spec.ts` em produção |
| Sobra/défice e repartição reserva / longo prazo | Testado (motor) | `financial-engine/src/monthly-plan.test.ts` |
| Opções por país com fonte oficial e data de revisão | Implementado | Migration 0800; descrições revistas a 16/11/2026, sem taxas |
| Importar despesas recorrentes para as fixas | Não iniciado | — |

## Prompt 03 · Fase 1: tarefas no servidor

Auditoria completa em [CURRENT_IMPLEMENTATION_AUDIT.md](CURRENT_IMPLEMENTATION_AUDIT.md).

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Agendador diário (`pg_cron`) e registo `job_runs` | Testado | `scheduler.test.ts`; em produção: `anen-daily-jobs` ativo, execução manual com sucesso |
| Recorrentes gerados no servidor para todos os âmbitos | Testado | `scheduler.test.ts` (isolamento de falhas, idempotência, autor) |

## Prompt 03 · Fase 2: recorrentes completos e anexos

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Editar recorrentes (sem mudar o calendário) | Testado | `recurring-attachments.test.ts` + E2E |
| Recorrentes com ligações, pendentes e vencimento | Testado | `recurring-attachments.test.ts` (servidor) + E2E |
| Anexos (enviar, abrir, remover; tipos e tamanho) | Testado | RLS em `recurring-attachments.test.ts`; E2E em produção (desktop e telemóvel) |
| Ficheiros órfãos após apagar a conta de um utilizador | Não iniciado | Os registos são apagados em cascata; os ficheiros no Storage precisam de uma tarefa de limpeza |

## Prompt 03 · Fase 3: CRM

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Observações datadas por contacto (nota, chamada, reunião, email, visita) | Testado | RLS em `crm.test.ts`; E2E `crm.spec.ts` em produção (desktop e telemóvel) |
| Pendentes do contacto ordenados por vencimento, vencidos assinalados | Implementado | Dados de `transactions` já testados |
| Orçamentos ligados ao cadastro de clientes e listados na ficha | Testado | `crm.test.ts` (âmbito, só clientes, bloqueio após aceite, projeto usa o cliente ligado) + E2E |
| Histórico de preços por fornecedor, com variação e ligação à despesa | Testado | `price-history.test.ts` (motor), `crm.test.ts` (RLS e coerência), E2E |
| Comparação do mesmo artigo entre fornecedores | Não iniciado | Fica para a fase de compras (8) |

## Prompt 03 · Fase 4: descontos, produto/serviço e descrição do projeto

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Desconto em % ou valor fixo, antes do imposto, com aviso abaixo do custo | Testado | `quote.test.ts` (motor), `validation.test.ts`, `quote-discounts.test.ts` (RLS, limites, bloqueio após aceite); E2E `quote-discounts.spec.ts` |
| Produto ou serviço por linha, totais por natureza no editor e no documento | Testado | `quote.test.ts`, `quote-discounts.test.ts` (inclui a versão guardada) + E2E |
| Descrição do projeto, copiada do orçamento; receita prevista já com desconto | Testado | `quote-discounts.test.ts` + E2E |
| Desconto por linha | Não iniciado | Só há desconto global por orçamento |

## Prompt 03 · Fase 5: fichas técnicas ligadas aos preços registados

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Ingrediente com preço de fornecedor registado, conversão kg/g, l/ml, dúzia/un | Testado | `units.test.ts`, `recipe-prices.test.ts`; E2E `recipe-prices.spec.ts` |
| Aviso de preço mais recente (ficha e lista), atualizar um ou todos | Testado | `recipe-prices.test.ts` (mesmo artigo e fornecedor, correções, RLS) + E2E |
| Permissões: ligação nova só com `business.read`; outra organização e outra moeda recusadas | Testado | `recipe-prices.test.ts` |
| Atualização automática do custo quando chega um preço novo | Não iniciado | Decisão: o custo só muda quando o utilizador confirma (fica no histórico) |
| Comparar o mesmo artigo entre fornecedores | Não iniciado | Fase de compras (8) |

## Prompt 03 · Fase 6: inteligência de mercado

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Fontes oficiais (Eurostat HICP, IBGE IPCA e SINAPI) com licença e ligação | Testado | `market.test.ts` com respostas reais gravadas; E2E `market.spec.ts` |
| Agente de mercado diário (pg_cron + http), idempotente, falhas isoladas, registo em `job_runs` | Testado (BD) | `market.test.ts`; em produção: extensão `http` instalada, `anen-market-agent` agendado, primeira execução com sucesso (36 séries, 864 observações) |
| Acompanhamento com limiar e alertas sem repetição; RLS e acessos cruzados | Testado | `market.test.ts` + E2E |
| Leitura das séries (acumulado de 3 meses, sentido) | Testado | `financial-engine/src/market.test.ts` |
| Preços de produtos concretos (supermercados, grossistas, combustíveis por posto) | Não iniciado | Requer contrato ou API com licença; a DGEG só tem uma API interna sem licença |
| Comparar o preço de um fornecedor com a inflação da categoria | Não iniciado | Falta ligar os artigos registados às categorias COICOP/IPCA |
| Resumo do mercado por IA | Bloqueado | Fase 7 (chave de API) |

## Prompt 03 · Fase 8: compras, inventário e reposição

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Artigos em stock com saldo e custo médio ponderado calculados no servidor | Testado | `stock.test.ts` (motor), `inventory.test.ts` (o servidor dá o mesmo resultado que o motor, RLS, acessos cruzados); E2E `purchases-inventory.spec.ts` |
| Movimentos imutáveis: entrada, saída, perda e contagem, sem saldo negativo | Testado | `inventory.test.ts` + E2E |
| Encomendas com estados, total do servidor e bloqueio depois de recebidas | Testado | `inventory.test.ts` + E2E |
| Receção: stock, preços do fornecedor e despesa (paga ou a pagar com vencimento) numa transação | Testado | `inventory.test.ts` (inclui receção sem `finance.write`) + E2E |
| Reposição: sugestões abaixo do mínimo e rascunhos por fornecedor | Testado | `inventory.test.ts` (desconta o já encomendado, âmbito pessoal) + E2E |
| Comparação do mesmo artigo entre fornecedores | Testado | `stock.test.ts` + E2E |
| Lotes e validades com saída FEFO ou lote escolhido, rastreio por lote, contagem que acerta os lotes | Testado | `stock-lots.test.ts` (invariante, FEFO, lote escolhido, contagem, RLS); E2E `stock-lots.spec.ts` (produção, 22/11/2026) |
| Consumo pelas fichas técnicas: ingrediente ligado ao stock, produção com desperdício e conversão de unidades, tudo ou nada | Implementado | `stock-lots.test.ts` (paridade das unidades SQL/motor, permissões); E2E idem |
| Avisos de lotes a vencer e vencidos (com antecedência nas preferências) | Implementado | `stock-lots.test.ts`; E2E idem |
| Lote e validade na receção de encomendas | Não iniciado | A receção cria lotes sem código nem validade; regista-se na entrada manual |
| Reposição agendada e notificações de stock baixo | Não iniciado | Fase 9 (notificações); hoje a reposição corre quando a pessoa carrega no botão |

## Prompt 03 · Fase 9: notificações, relatórios e otimização

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Notificações na aplicação: pagamentos vencidos e a vencer, stock abaixo do mínimo, encomendas atrasadas e alertas de mercado | Testado | `notifications.test.ts` (destinatários por permissão, sem repetição, episódios de stock, outra organização); E2E `notifications-reports.spec.ts` |
| Tarefa diária `anen-notifications` e atualização ao abrir a página | Testado | `notifications.test.ts`; em produção: agendada e executada com sucesso a 21/11/2026 |
| Preferências por pessoa (tipos e antecedência) | Testado | `notifications.test.ts` + E2E |
| Contador no menu, abrir no contexto certo, marcar como lidas | Testado | E2E |
| Notificações por email ou push | Bloqueado | Falta um serviço de email (SMTP, Resend…) e contas de push |
| Relatórios por período: faturado e liquidado por categoria, contacto, projeto e centro de custo, mês a mês; exportação CSV | Testado | `report.test.ts` (motor), `notifications.test.ts` (RLS de `finance_report`) + E2E |
| Otimização: índices para relatórios, notificações, encomendas atrasadas e stock; contador com índice parcial | Implementado | Migration 1600 |
| Filtro de período no painel (este mês, 3 meses, 12 meses) contra o período anterior; a nota de saúde continua a ser do mês | Testado | `dashboard-period.test.ts`; E2E `dashboard-period.spec.ts` (produção, 22/11/2026) |

## ANEN AI e planos

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Planos Free, Pro e Max com limites em dados; atribuição por administradores | Testado | `plans-ai.test.ts` |
| ANEN AI só no Pro (25 perguntas/dia) e no Max (100/dia), por conta, com o limite aplicado no servidor | Testado | `plans-ai.test.ts` (trava, falha devolve a vaga, outra organização) + E2E `ai.spec.ts` |
| Consentimento antes do primeiro uso | Testado | `plans-ai.test.ts` + E2E |
| Assistente com ferramentas determinísticas: resumo financeiro, comparação de períodos, pendentes, duplicados, projetos, preços de fornecedores, reposição, receita necessária, orçamentos | Testado | `insights.test.ts` (motor), `gemini.test.ts` (adaptador); E2E em produção com o modelo real |
| Fontes por resposta (ligações para os registos) e ferramentas usadas | Testado | E2E |
| Recurso automático entre modelos (Gemini 3.5 Flash → 3.8 Flash → 3.5 Flash-Lite) | Testado | `gemini.test.ts` |
| Centro de inteligência: recomendações determinísticas (7 ou 30 dias vs. período anterior) com dados, impacto, prioridade e confiança, em todos os planos | Implementado | `intelligence.test.ts` (motor); E2E `intelligence.spec.ts` por correr em produção |
| Resumo da ANEN AI por período, guardado (`ai_digests`), Pro e Max | Implementado | `ai-digests.test.ts` (RLS); E2E por correr |
| Resumos enviados automaticamente (email ou push) | Bloqueado | Falta um serviço de email; o resumo é gerado a pedido |
| Cobrança dos planos | Bloqueado | Conta Stripe (ou alternativa) e preços |

## Faturação certificada (Portugal, via InvoiceXpress)

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Ligar a conta InvoiceXpress de cada cliente (chave validada no InvoiceXpress e guardada cifrada) | Testado | `invoicexpress.test.ts` (cifra), `invoicing.test.ts` (RLS); E2E `invoicing.spec.ts` contra o InvoiceXpress real |
| Fatura, fatura-recibo, fatura simplificada, guia de transporte e de remessa: rascunho → emitir → anular | Implementado | Cliente da API testado com respostas da documentação oficial (`invoicexpress.test.ts`); falta testar com uma conta InvoiceXpress real |
| Nota de crédito a partir de uma fatura emitida | Implementado | Idem |
| Emitir liga às finanças (a receber ou recebido), dá baixa no stock e liga ao projeto; anular desfaz o que ainda não foi pago | Implementado | Idem |
| Faturar a partir de um orçamento aceite | Implementado | Botão "Faturar" no orçamento |
| PDF oficial e envio por email pelo InvoiceXpress; código AT das guias | Implementado | Idem |
| Documento bloqueado depois de emitido (conteúdo, linhas, estados) | Testado | `invoicing.test.ts` |
| Brasil (NF-e/NFS-e) | Não iniciado | Outro fornecedor certificado |

## Dual Workspace · Fase 1: auditoria e revisão

Auditoria em [DUAL_ARCHITECTURE_AUDIT.md](DUAL_ARCHITECTURE_AUDIT.md), problemas em [QA_REVIEW.md](QA_REVIEW.md).

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Auditoria da arquitetura, zona visual protegida e plano | Implementado | `DUAL_ARCHITECTURE_AUDIT.md` |
| QA-01: introduzir valores em "A Receber" e "A Pagar" | Testado | `open-items.test.ts`; E2E `open-items.spec.ts` |
| QA-02 e QA-11: eliminar movimento ou anexo só no contexto ativo; ficheiros removidos do Storage | Testado | E2E `recurring-attachments.spec.ts` (verifica o ficheiro no Storage) |
| QA-08 a QA-10, QA-12, QA-14, QA-15, QA-17 | Não iniciado | Ver `QA_REVIEW.md` |

## Dual Workspace · Fase 2: workspaces, conta única e membros

Modelo em [WORKSPACE_DATA_MODEL.md](WORKSPACE_DATA_MODEL.md) (opção A: camada sobre o modelo atual, sem migrar dados).

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Vistas `workspaces` e `workspace_members` (só leitura, RLS das tabelas de origem) | Testado (BD) | `workspaces.test.ts` (14, com acessos cruzados, suspensão e anónimos). Aplicada em produção a 23/11/2026 |
| `can_access_workspace` (pessoal só o próprio; empresa por membro ativo ou permissão) | Testado (BD) | `workspaces.test.ts` |
| Espaço pessoal garantido e idempotente (`ensure_personal_workspace`, também na sessão) | Testado (BD) | `workspaces.test.ts` (idempotência, conta antiga) |
| `lib/workspace.ts`: workspace ativo, âmbito por módulo, lista, chave e resolução; `financeScope`, `businessScope` e `quotesScope` derivados | Testado | `workspace.test.ts` (6); E2E `accounts`, `finance`, `business`, `open-items`, `notifications-reports` (14, desktop e telemóvel) |
| QA-07: erro ao mudar de contexto passa a ser mostrado | Implementado | O caminho de erro não tem teste automático; a mudança normal está coberta pelo E2E `accounts` |

## Dual Workspace · Fase 3: separação dos dados e segurança no servidor

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Gravações só no workspace que estava no ecrã (QA-03): campo `__workspace` em todos os formulários, `guardWorkspace` em 78 ações, falha fechada | Testado | `workspace.test.ts`, `workspace-guard-coverage.test.ts`; E2E `workspace-guard.spec.ts` (duas abas) |
| Invariantes de isolamento em todas as tabelas com âmbito | Testado (BD) | `isolation.test.ts` (14) |
| Gatilho `workspace_immutable` em todas as tabelas; auditoria de recorrências, anexos, orçamentos mensais e objetivos | Testado (BD) | `isolation.test.ts`. Migration 2800 aplicada em produção a 23/11/2026 |
| QA-05: importação só com categorias do workspace ativo | Testado | E2E `bank-import.spec.ts` |
| E2E completos com o código da fase | 49 a passar, 1 ignorado, 12 dependentes de chaves que a app local não tem | `QA_REVIEW.md` |

## Dual Workspace · Fase 4: seletor de contexto e navegação adaptativa

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Menu por workspace (QA-04): pessoal sem módulos de empresa sem uso; organização por permissão de leitura | Testado | `modules.test.ts`; E2E `workspace-nav.spec.ts`, `review-settings.spec.ts` |
| Convites pendentes no seletor, aceites sem o link | Testado (em produção) | `my-invitations.test.ts` (7); E2E `workspace-nav.spec.ts` contra produção. Migration 2900 aplicada a 23/11/2026 |
| Abas sincronizadas (BroadcastChannel e `/api/workspace` ao voltar à aba); estado do cliente recomeça ao mudar | Testado | E2E `workspace-nav.spec.ts` |
| Contexto no endereço (`/app/pessoal/...`) | Não iniciado | Decisão: não mudar os 49 endereços; a guarda de gravação (Fase 3) e a sincronização cobrem o risco. Ver `DUAL_ARCHITECTURE.md` D7 |

## Dual Workspace · Fase 5: ambiente pessoal

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Parcelas mensais com fim (§5.6): total ou por parcela, fim por número ou data, último dia do mês, cêntimos na última, "Parcela n de N", pagar uma a uma, cancelar restantes, alterar as seguintes; pessoal e empresa | Testado (em produção) | `financial-engine/src/installments.test.ts` (8), `database/tests/installments.test.ts` (19, paridade motor/SQL); E2E `installments.spec.ts` contra produção. Migration 3000 aplicada a 23/11/2026 |
| Orçamento do mês mostra o previsto por pagar à parte do gasto | Implementado | Sem E2E próprio |
| Painel "Hoje", assinaturas, dívidas, calendário, menu pessoal da secção 5 | Não iniciado | Parte 2 da Fase 5 |

## Fases seguintes

| Fase | Estado | O que é preciso para avançar |
|---|---|---|
| 4: Pesquisa de preços | Em desenvolvimento | Índices oficiais feitos (Fase 6 do prompt 03). Falta decidir que fornecedores de preços de produtos licenciar |
| 5: Fiscalidade PT/BR | Não iniciado | Validação jurídica/contabilística das regras e taxas (não se inventam taxas) |
| 6: IA | Em desenvolvimento | ANEN AI e centro de inteligência feitos. Falta o envio automático dos resumos (serviço de email) |
| 7: Marketplace | Não iniciado | Serviço de mapas (chave) e definição de regras de moderação |
| 8: Monetização Free/Pro/Max | Não iniciado | Conta Stripe (ou alternativa) validada para PT e BR, preços dos planos |
| 9: Mobile | Não iniciado | Conta Expo/EAS, Apple Developer e Google Play |
| 10: Produção | Em desenvolvimento | Domínio próprio, SMTP próprio, plano Supabase com backups/PITR, monitorização |

## Testes

- **492 testes automáticos** (`npm test`, 23/11/2026): motores financeiro, de orçamentos, de receitas, de projetos, do plano do mês, do histórico de preços, do stock e dos relatórios; validação; i18n; RLS e acessos cruzados em Postgres 17 real (PGlite).
- **42 testes E2E (21 cenários × desktop e telemóvel)** (`npx playwright test`) contra produção, todos a passar a 22/11/2026.
