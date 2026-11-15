# ANEN

Plataforma de finanças, orçamentos e serviços para profissionais, empresas e clientes, em Portugal e no Brasil.

**Estado:** Fase 1 (Fundação) implementada. Ver [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Começar

Requisitos: Node 22+.

```bash
npm install
cp .env.example apps/web/.env.local   # preencher com os dados do projeto Supabase
npm run dev                           # http://localhost:3000
```

Sem Supabase configurado, a app arranca e mostra o aviso "Configuração em falta" em vez de dados simulados.

Base de dados: aplicar `supabase/migrations` ao projeto (ver [DEPLOYMENT.md](DEPLOYMENT.md)).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | App web em desenvolvimento |
| `npm test` | Testes: motores, validação, i18n e RLS da base de dados (PGlite) |
| `npm run typecheck` | TypeScript estrito em todos os workspaces |
| `npm run build` | Build de produção |

## Estrutura

```
apps/web                   Next.js 16 · App Router · Server Actions
packages/financial-engine  Decimal exato, Money, margem/markup
packages/validation        Zod, NIF/CPF/CNPJ
packages/i18n              pt-PT, pt-BR
packages/types             Tipos de domínio e da base de dados
packages/ui                Tokens de design
packages/database          Harness de testes das migrations
supabase/                  Migrations, templates de email, config
```

## Documentação

[Auditoria](PROJECT_AUDIT.md) · [Arquitetura](ARCHITECTURE.md) · [Base de dados](DATABASE_SCHEMA.md) · [API](API_DOCUMENTATION.md) · [Segurança](SECURITY.md) · [Testes](TESTING.md) · [Deploy](DEPLOYMENT.md) · [Motor fiscal](TAX_ENGINE.md) · [Motor de preços](PRICING_ENGINE.md) · [Changelog](CHANGELOG.md)
