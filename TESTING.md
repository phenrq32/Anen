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

## E2E (Playwright)

```bash
# Corre contra produção por omissão (E2E_BASE_URL para outro ambiente).
# A chave secreta só existe na sessão do terminal: nunca no repositório.
E2E_SUPABASE_URL=https://<ref>.supabase.co E2E_SUPABASE_SECRET_KEY=<sb_secret_...> npx playwright test
```

Os testes criam contas já confirmadas pela API de administração e apagam-nas (com as organizações) no fim. Cobrem contas, convites, finanças, orçamentos e fichas técnicas, cada um em desktop e em telemóvel (Pixel 7).

## Pendente

- Um projeto Supabase de **staging** separado, para que os E2E não corram contra produção.
- **Testes visuais e de responsividade** em 360 px, 768 px e 1280 px.
- **Testes das migrations contra Supabase real** (`supabase db reset` + suite de RLS ligada a esse Postgres).
