# Arquitetura

## Visão geral

```
Browser ──► Next.js (apps/web) ──► Supabase (Auth · PostgREST · Postgres + RLS · Storage)
             │  Server Components / Server Actions        ▲
             │  proxy.ts: renovação de sessão            │ chave publicável + JWT do utilizador
             └─ packages/* (motores determinísticos, validação, i18n)
Mobile (Fase 9) ──► mesmo Supabase, mesmos pacotes
```

- **Sem servidor próprio na Fase 1:** a app web fala com o Supabase usando a sessão do utilizador. Toda a autorização acontece em Postgres (RLS e funções RPC).
- **Server Actions** validam a entrada com Zod antes de qualquer chamada. A base de dados volta a validar (defesa em profundidade).
- **A chave service_role** nunca é usada na app web. Fica reservada a Edge Functions e jobs (webhooks Stripe, importação de preços, envio de emails).

## Decisões (ADR resumidas)

| # | Decisão | Motivo |
|---|---|---|
| 1 | Monorepo com npm workspaces | Sem pnpm/turbo no ambiente. Os pacotes são consumidos como fonte TS (`transpilePackages`), sem passo de build. |
| 2 | Supabase como backend | Auth, Postgres, Storage e RLS integrados. Isolamento multi-organização garantido pela base de dados. |
| 3 | Escritas sensíveis via RPC `SECURITY DEFINER` | Permite regras que o RLS sozinho não exprime (hierarquia de funções, último proprietário, convites com token). |
| 4 | Dinheiro em unidades mínimas `bigint` + decimal exato próprio | Elimina erros de ponto flutuante sem dependências. A moeda acompanha sempre o valor. |
| 5 | Mensagens de erro como chaves de tradução | O SQL e o Zod devolvem chaves e a UI traduz. Nunca se mostram detalhes técnicos. |
| 6 | Idioma, país, moeda e fuso independentes | Requisito do produto: um utilizador pode usar pt-BR, viver em PT e gerir uma empresa no BR. |
| 7 | Testes de RLS com PGlite | Testam políticas reais em Postgres 17 sem Docker e correm em CI em cerca de 2 s. |
| 8 | Contexto ativo em `user_preferences.active_organization_id` | Alternar entre pessoal e organizações sem contas duplicadas. A mudança é validada por trigger. |

## Organização do código web

```
apps/web/src
  app/(auth)/        entrar, criar-conta, recuperar-acesso, nova-senha + actions
  app/(app)/         área autenticada: painel, organizacao/*, organizacoes/nova, definicoes + actions
  app/auth/          confirm (token_hash/PKCE), callback (OAuth), sair (POST)
  app/boas-vindas/   onboarding
  app/convite/[t]/   aceitar convite
  components/        ui.tsx (primitivas), forms.tsx (estados de formulário), app-shell
  lib/               supabase, session (contexto do pedido), i18n, errors, reference
  proxy.ts           renovação de sessão e proteção de rotas
```

## Contextos e permissões

- Cada utilizador tem um **contexto pessoal** e zero ou mais **organizações** (independente ou empresa).
- Funções de sistema, por nível hierárquico: proprietário (100), administrador (80), gestor (60), contabilista (40), funcionário (30), leitor (10). Cada organização pode criar funções personalizadas.
- Regra de hierarquia: só se atribui ou gere uma função de nível inferior ao próprio. O proprietário pode tudo, mas a organização nunca fica sem proprietário.
- Ninguém concede permissões que não possui.
