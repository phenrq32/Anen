# API

Na Fase 1 a API é o próprio Supabase (PostgREST), protegido por RLS. A app web usa Server Actions e não expõe endpoints REST próprios.

## RPC (`supabase.rpc(nome, args)`, utilizador autenticado)

| Função | Argumentos | Devolve | Erros (chaves i18n) |
|---|---|---|---|
| `create_organization` | `p_kind`, `p_name`, `p_country_code`, `p_currency_code`, `p_timezone`, `p_legal_name?`, `p_tax_id?`, `p_region_id?` | `uuid` | `unauthorized`, `organization_limit`, `tax_id_invalid`, `region_country_mismatch`, `unsupported_reference`, `timezone_invalid` |
| `invite_member` | `p_organization_id`, `p_email`, `p_role_id` | `{invitation_id, token, expires_at}[]` | `forbidden`, `role_invalid`, `rank_violation`, `email_invalid`, `already_member`, `invitation_pending` |
| `get_invitation` (também anon) | `p_token` | `{organization_name, role_key, role_name, email, expires_at}[]` | vazio se inválido |
| `accept_invitation` | `p_token` | `uuid` da organização | `invitation_invalid`, `invitation_email_mismatch`, `already_member` |
| `revoke_invitation` | `p_invitation_id` | — | `forbidden`, `rank_violation`, `invitation_invalid` |
| `update_member` | `p_member_id`, `p_role_id`, `p_status` | — | `forbidden`, `rank_violation`, `role_invalid`, `last_owner` |
| `remove_member` | `p_member_id` | — | `forbidden`, `rank_violation`, `last_owner` |
| `upsert_role` | `p_organization_id`, `p_name`, `p_permissions`, `p_description?`, `p_role_id?`, `p_rank?` | `uuid` | `forbidden`, `rank_violation`, `permission_not_held` |
| `delete_role` | `p_role_id` | — | `forbidden`, `rank_violation`, `role_in_use` |

## Rotas HTTP da app web

| Rota | Método | Função |
|---|---|---|
| `/auth/confirm` | GET | Confirmação de email e recuperação (`token_hash` + `type`, ou `code`) |
| `/auth/callback` | GET | Retorno do OAuth |
| `/auth/sair` | POST | Terminar sessão (verifica a origem) |
