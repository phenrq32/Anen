# Changelog

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
