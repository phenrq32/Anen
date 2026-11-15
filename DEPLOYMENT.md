# Deploy

## Ambientes

| Ambiente | Supabase | Web |
|---|---|---|
| Desenvolvimento | Projeto dev (ou `supabase start` com Docker) | `npm run dev` |
| Staging | Projeto Supabase separado | Preview Vercel |
| Produção | Projeto Supabase com PITR | Vercel (produção) |

Nunca partilhar a base de dados entre ambientes.

## 1. Supabase

1. Criar o projeto (região UE, por exemplo `eu-west-1`, por causa do RGPD; avaliar `sa-east-1` para dados de clientes brasileiros).
2. Aplicar as migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. **Authentication → URL Configuration:** Site URL = URL de produção. Redirect URLs = `<site>/auth/confirm` e `<site>/auth/callback`.
4. **Authentication → Email Templates:** copiar `supabase/templates/confirmation.html` (Confirm signup) e `recovery.html` (Reset password). Os links usam `token_hash`, por isso funcionam noutro dispositivo.
5. **Authentication → SMTP:** configurar um fornecedor (Resend, Postmark ou SES). O SMTP interno do Supabase não serve produção.
6. **Authentication → Policies:** mínimo de 10 caracteres, letras e dígitos.
7. Gerar tipos: `npx supabase gen types typescript --project-id <ref> > packages/types/src/database.generated.ts`.

## 2. Web (Vercel)

- Root directory: `apps/web`. Install: `npm ci` (na raiz). Build: `npm run build`.
- Variáveis (ver `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` e `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`.
- **Não** definir `SUPABASE_SERVICE_ROLE_KEY` no projeto web.

## 3. Checklist antes de produção

- [ ] `npm run check` e `npm run build` verdes na CI
- [ ] Migrations aplicadas em staging e testadas
- [ ] E2E de registo, confirmação, login, recuperação e convite em staging
- [ ] SMTP próprio com SPF/DKIM
- [ ] Backups/PITR ativos
- [ ] Domínio próprio com HTTPS
- [ ] Política de privacidade e termos publicados (RGPD/LGPD)
