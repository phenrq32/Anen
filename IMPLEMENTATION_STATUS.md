# Estado de implementação

Estados: Não iniciado · Em desenvolvimento · Implementado · Testado · Aprovado · Bloqueado.
"Testado" significa coberto por testes automáticos que passam. "Aprovado" exige validação humana em staging, e nada está aprovado ainda.

_Atualizado em 15/11/2026._

## Fase 1 — Fundação

| Funcionalidade | Estado | Evidência / notas |
|---|---|---|
| Auditoria do projeto | Implementado | [PROJECT_AUDIT.md](PROJECT_AUDIT.md) |
| Arquitetura e monorepo | Implementado | [ARCHITECTURE.md](ARCHITECTURE.md). Typecheck limpo em todos os workspaces. |
| Motor financeiro (decimal exato, Money, margem/markup, repartição) | Testado | 25 testes em `packages/financial-engine` |
| Validação (Zod, NIF, CPF, CNPJ alfanumérico, redirect seguro) | Testado | 14 testes em `packages/validation` |
| i18n pt-PT / pt-BR, formatação de moeda e datas | Testado | 6 testes, incluindo paridade de chaves entre idiomas |
| Base de dados: referência, perfis, preferências | Testado | Migrations 0100–0200, testes de RLS |
| Organizações, RBAC, hierarquia, convites | Testado | 26 testes de RLS e acessos cruzados (PGlite) |
| Auditoria | Testado | Triggers e visibilidade por permissão testadas |
| Registo, login, recuperação, verificação de email | Implementado | Fluxos completos com o Supabase Auth. **Falta o teste E2E contra um projeto Supabase real** (bloqueado). |
| Login Google | Implementado | Desativado até configurar o provider (`NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`) |
| Onboarding (tipo de conta, país, idioma, moeda, fuso) | Implementado | E2E pendente (Supabase) |
| Alternar contexto pessoal / organização | Implementado | Validação da troca testada na base de dados |
| Gestão de membros e funções (UI) | Implementado | Regras testadas na BD. E2E pendente. |
| Design system (tokens, primitivas, estados de carregamento, vazio, erro e sucesso) | Implementado | `packages/ui`, `components/ui.tsx`, `forms.tsx` |
| Dashboard | Implementado | Mostra dados reais (organização, membros, convites, auditoria). Os blocos financeiros indicam que o módulo ainda não está ativo, sem valores fictícios. |
| CI | Implementado | `.github/workflows/ci.yml` (typecheck, testes e build) |
| Projeto Supabase de produção | **Bloqueado** | A conta atingiu o limite de 2 projetos gratuitos |
| Deploy web | **Bloqueado** | Depende do Supabase e de uma conta de hosting |
| Envio de convites por email | Não iniciado | O link é gerado e copiado manualmente. Falta um fornecedor de email. |

## Fases seguintes

| Fase | Estado | Dependências principais |
|---|---|---|
| 2 — Finanças | Não iniciado | Fase 1 |
| 3 — Orçamentos e PDF | Não iniciado | Fase 2, motor de PDF |
| 4 — Pesquisa de preços | Não iniciado | Chaves e termos das fontes (INE, Eurostat, IBGE…) |
| 5 — Fiscalidade PT/BR | Não iniciado | Validação jurídica das regras |
| 6 — IA | Não iniciado | Fases 2–5, API de modelos |
| 7 — Marketplace | Não iniciado | Serviço de mapas |
| 8 — Monetização | Não iniciado | Stripe validado para PT e BR |
| 9 — Mobile | Não iniciado | Expo/EAS, contas Apple e Google |
| 10 — Produção | Não iniciado | Todas |

## Total de testes

75 testes automáticos a passar (`npm test`).
