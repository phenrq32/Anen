# Modelo de dados dos workspaces

_Dual Workspace · Fase 2 · 23/11/2026._ Decisão: opção A de [DUAL_ARCHITECTURE_AUDIT.md](DUAL_ARCHITECTURE_AUDIT.md) §6. Há uma camada "workspace" sobre o modelo existente, sem mover dados. Migration: `supabase/migrations/20261123002700_workspaces.sql`.

## Conceito

| Workspace | O que é | Id | Coluna nos registos |
|---|---|---|---|
| `PERSONAL` | O espaço pessoal do utilizador (um por conta) | Id do utilizador (`auth.users.id`) | `owner_user_id` |
| `BUSINESS` | Uma organização (`organizations.kind` = `business` ou `independent`) | Id da organização | `organization_id` |

Cada registo financeiro ou operacional tem exatamente uma das duas colunas. A restrição `check ((organization_id is null) <> (owner_user_id is null))` garante isto em todas as tabelas com âmbito. O workspace de um registo não muda numa edição, porque as colunas de âmbito não estão nos `grant update`.

## Correspondência com as entidades do prompt

| Prompt | Implementação |
|---|---|
| `users` (id, email, name, avatar, locale, timezone) | `auth.users` (email) + `users_profiles` (nome, avatar) + `user_preferences` (idioma, fuso, país, moeda) |
| `workspaces` | Vista `public.workspaces` (só leitura) |
| `workspace_members` | Vista `public.workspace_members` (só leitura); as escritas continuam nas RPCs `invite_member`, `accept_invitation`, `update_member` e `remove_member` |
| `workspace_settings` | Pessoal: `user_preferences`, `notification_settings`. Empresarial: colunas de `organizations`. Não há uma tabela nova; uma tabela genérica de definições ficaria sem validação por campo |
| Criação automática do espaço pessoal | Gatilho `private.handle_new_user` no registo, mais `public.ensure_personal_workspace()`, idempotente, para contas a que falte |
| Criação de organizações | RPC `create_organization` (já existia): o criador fica proprietário |

## Vista `public.workspaces`

`security_invoker = true`: o RLS das tabelas de origem decide o que aparece. A pessoa vê a sua linha `PERSONAL` (de `user_preferences`, legível só pelo próprio) e as organizações em que é membro **ativo** (política de `organizations`).

| Coluna | PERSONAL | BUSINESS |
|---|---|---|
| `id` | Id do utilizador | Id da organização |
| `type` | `PERSONAL` | `BUSINESS` |
| `name` | `null` (a interface mostra "Pessoal" no idioma de quem vê) | Nome da organização |
| `organization_kind` | `null` | `business` ou `independent` |
| `owner_user_id` | O próprio | Quem criou a organização (os proprietários atuais estão em `workspace_members`) |
| `country_code`, `currency_code`, `timezone` | Das preferências | Da organização |
| `region_id` | `null` | Da organização |
| `language_code` | Das preferências | `null` (cada membro usa o seu idioma) |

## Vista `public.workspace_members`

`workspace_id`, `workspace_type`, `user_id`, `role_key`, `status`, `created_at`. No pessoal, só o próprio, como `owner`. Numa organização, os membros com a função (`owner`, `admin`, `manager`, `accountant`, `employee`, `viewer` ou personalizada), visíveis só a membros ativos.

## Funções

| Função | Regra |
|---|---|
| `private.can_access_workspace(type, id, permission?)` | `PERSONAL`: só se `id = auth.uid()`. `BUSINESS`: membro ativo (sem permissão indicada) ou `has_org_permission`. Tipo desconhecido, id nulo ou anónimo: `false`. É a verificação para as RPCs das fases seguintes (por exemplo, transferências entre espaços) |
| `public.can_access_workspace(...)` | Expõe a anterior para a interface. A autorização real continua no RLS de cada tabela |
| `public.ensure_personal_workspace()` | Cria o perfil e as preferências em falta, com `on conflict do nothing`. Nunca duplica nem altera o que existe. Devolve o id do workspace pessoal. Anónimos: recusado |

Privilégios: as vistas e funções são revogadas a `public`/`anon`; `authenticated` tem só `select` nas vistas e `execute` nas funções. As vistas não aceitam escritas.

## Na aplicação

- `@anen/types`: `WorkspaceType`, `WorkspaceRef`, `Workspace`, `WorkspaceMember`, e as vistas e funções em `Database`.
- `apps/web/src/lib/workspace.ts` (funções puras, testadas em `workspace.test.ts`):
  - `activeWorkspace(session)`: o workspace ativo, determinado no servidor a partir da sessão.
  - `workspaceScope(session, { read, write })`: coluna, valor e permissões. `financeScope`, `businessScope` e `quotesScope` passam a ser apenas `workspaceScope` com `finance.*`, `business.*` e `quotes.*`.
  - `listWorkspaces(session)`: o pessoal primeiro, depois as organizações, com o ativo marcado.
  - `resolveWorkspace(session, pedido)`: só aceita workspaces da própria pessoa; um id de outra organização devolve `null`.
  - `workspaceKey(ref)`: `personal` ou `org:<id>`, para separar caches (Fase 4).
- `lib/session.ts`: se faltar o perfil ou as preferências, chama `ensure_personal_workspace` em vez de devolver a pessoa ao login.
- `switchContextAction`: usa `resolveWorkspace` e, se a gravação falhar, mostra o erro (QA-07).

## Testes

- `packages/database/tests/workspaces.test.ts` (14): um único espaço pessoal por conta; idioma pt-BR → BRL e São Paulo; `ensure_personal_workspace` idempotente e sem alterar preferências; reposição de uma conta antiga; cada pessoa só vê os seus workspaces; o id de outra organização ou pessoa não dá acesso; os dados pessoais da proprietária não aparecem aos membros; membros e funções; permissões (o leitor não convida); membro suspenso perde o acesso e recupera-o; tipo desconhecido e id nulo sem acesso; vistas só de leitura; anónimos recusados.
- `apps/web/src/lib/workspace.test.ts` (6): âmbito pessoal e empresarial, permissões por módulo, lista, chave e resolução.

## Reversão

```sql
drop view if exists public.workspace_members, public.workspaces;
drop function if exists public.ensure_personal_workspace(), public.can_access_workspace(text, uuid, text), private.can_access_workspace(text, uuid, text);
```

Do lado do código, `git revert` do commit da Fase 2. Não há dados a repor: a migration não altera nenhuma linha.
