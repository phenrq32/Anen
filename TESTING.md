# Testes

```bash
npm test            # todos os testes (Vitest)
npm run typecheck   # TypeScript estrito em todos os workspaces
npm run build       # build de produção da app web
```

## O que é testado

| Suite | Ficheiro | Cobertura |
|---|---|---|
| Motor financeiro | `packages/financial-engine/src/financial-engine.test.ts` | Decimal exato, modos de arredondamento, Money por moeda, rejeição de precisão excessiva, percentagens, repartição, fórmulas, margem e markup |
| Validação | `packages/validation/src/validation.test.ts` | NIF, CPF, CNPJ numérico e alfanumérico (exemplo oficial da RFB), esquemas Zod, `safeNextPath` |
| i18n | `packages/i18n/src/i18n.test.ts` | Paridade de chaves pt-PT/pt-BR, Accept-Language, moeda sem float (valores acima de 2^53), datas por fuso |
| Base de dados / RLS | `packages/database/tests/rls.test.ts` | Aplica todas as migrations num Postgres 17 (PGlite) que emula o Supabase e testa isolamento, acessos cruzados, anónimos, grants de coluna, hierarquia, convites, último proprietário, auditoria e eliminação em cascata |
| Web | `apps/web/src/lib/errors.test.ts` | Mapeamento de erros sem fugas técnicas, incluindo chaves herdadas do protótipo |

## Como funcionam os testes de RLS

`packages/database/src/index.ts` cria os papéis `anon`, `authenticated` e `service_role`, o esquema `auth` com `users` e `auth.uid()`, e os privilégios por omissão do Supabase. Depois aplica `supabase/migrations` por ordem. `asUser()` executa SQL como o PostgREST faria (`set local role` + `request.jwt.claims`).

## Pendente

- **E2E (Playwright)** dos fluxos de conta contra um projeto Supabase de staging: registo, confirmação, login, recuperação, onboarding, organização e convite. Está bloqueado até existir o projeto.
- **Testes visuais e de responsividade** em 360 px, 768 px e 1280 px.
- **Testes das migrations contra Supabase real** (`supabase db reset` + suite de RLS ligada a esse Postgres).
