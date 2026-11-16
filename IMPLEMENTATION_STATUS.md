# Estado de implementação

Estados: Não iniciado · Em desenvolvimento · Implementado · Testado · Aprovado · Bloqueado.
"Testado" = coberto por testes automáticos que passam (unitários/RLS e E2E em produção). "Aprovado" exige validação humana, e nada está aprovado ainda.

_Atualizado em 16/11/2026._ Produção: **https://anen-five.vercel.app** (Vercel + Supabase eu-west-1).

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

## Fases seguintes

| Fase | Estado | O que é preciso para avançar |
|---|---|---|
| 4: Pesquisa de preços | Não iniciado | Registo/chaves nas fontes (INE, Eurostat, IBGE…) e decisão sobre que fornecedores de preços licenciar |
| 5: Fiscalidade PT/BR | Não iniciado | Validação jurídica/contabilística das regras e taxas (não se inventam taxas) |
| 6: IA | Não iniciado | Chave de API de modelos de linguagem (Anthropic ou outro) |
| 7: Marketplace | Não iniciado | Serviço de mapas (chave) e definição de regras de moderação |
| 8: Monetização Free/Pro/Max | Não iniciado | Conta Stripe (ou alternativa) validada para PT e BR, preços dos planos |
| 9: Mobile | Não iniciado | Conta Expo/EAS, Apple Developer e Google Play |
| 10: Produção | Em desenvolvimento | Domínio próprio, SMTP próprio, plano Supabase com backups/PITR, monitorização |

## Testes

- **132 testes automáticos** (`npm test`): motores financeiro, de orçamentos e de receitas; validação; i18n; RLS e acessos cruzados em Postgres 17 real (PGlite).
- **12 testes E2E** (`npx playwright test`) contra produção, em desktop e telemóvel.
