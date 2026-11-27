# Testes dos workspaces (Pessoal e Empresarial)

Como se prova que os dados dos workspaces não se misturam. Comandos gerais em [TESTING.md](TESTING.md).

## Camadas de proteção e o teste de cada uma

| Camada | O que garante | Testes |
|---|---|---|
| RLS em Postgres | Ninguém lê nem escreve dados de um workspace a que não pertence, mesmo que altere o identificador enviado | Testes por tabela em `packages/database/tests/*` (finance, business, crm, inventory, invoicing, open-items, workspaces…) |
| Invariantes em **todas** as tabelas com âmbito | RLS ativo; anónimos sem privilégios; um único dono por registo; nenhuma política aberta; políticas sempre dependentes de quem pede; o gatilho `workspace_immutable` presente | `packages/database/tests/isolation.test.ts`. Descobre as tabelas sozinho, por isso uma tabela nova que falhe uma regra parte o teste |
| Um registo nunca muda de workspace | `organization_id`/`owner_user_id` não mudam numa edição, nem sem RLS | `isolation.test.ts`: contas, orçamentos mensais, objetivos, contactos e categorias, para o pessoal e para outra empresa |
| Vistas de workspaces | Cada pessoa só vê o seu pessoal e as organizações em que é membro ativo; suspensos perdem acesso | `workspaces.test.ts` |
| Workspace ativo no servidor | Âmbito, permissões e resolução nunca confiam num valor do cliente | `apps/web/src/lib/workspace.test.ts` |
| Formulário de uma aba antiga (QA-03) | Uma gravação só acontece no workspace que estava no ecrã; sem workspace, recusa (falha fechada) | `workspace.test.ts` (`checkWorkspaceKey`); `workspace-guard-coverage.test.ts` (todas as ações começam por `guardWorkspace` e todos os formulários enviam o campo); E2E `workspace-guard.spec.ts` (duas abas) |
| Transferências entre espaços (Fase 7) | Permissão de escrita nos dois lados; os dois movimentos ficam ou nenhum; pedido repetido não duplica; movimentos bloqueados; reversão por compensação; outra empresa não vê | `cross-workspace-transfers.test.ts`; E2E `transfers.spec.ts` |
| IA por espaço (Fase 8) | `PERSONAL_AI_CONTEXT` e `BUSINESS_AI_CONTEXT`: o modelo só recebe as ferramentas do contexto e o servidor recusa as outras antes de consultar dados; conversas de outro espaço recusadas | `apps/web/src/lib/ai/context.test.ts`, `tools.test.ts`; `ia/actions.ts` (organização da conversa) |
| Limites dos planos (Fase 9) | Validados na base ao criar organizações, membros, projetos, orçamentos e índices; versões futuras sem efeito; só administradores mudam | `plan-limits.test.ts` |
| Fluxos completos no browser | Criar, editar e apagar em cada módulo, em desktop e telemóvel | `e2e/*.spec.ts` |

## Testes negativos de segurança (exemplos)

- Um utilizador da Empresa B tenta ler, liquidar ou apagar um valor em aberto da Empresa A pelo identificador: 0 linhas (`open-items.test.ts`).
- Um utilizador tenta gravar no workspace de outro, mesmo com uma conta sua: recusado (`open-items.test.ts`).
- Os dados pessoais da proprietária não aparecem aos membros da sua empresa (`open-items.test.ts`, `workspaces.test.ts`).
- Conhecer o id de uma organização não dá acesso (`workspaces.test.ts`, `workspace.test.ts`).
- Um membro suspenso deixa de ver o workspace (`workspaces.test.ts`).
- A dona de duas empresas não consegue mover uma conta, um orçamento mensal, um objetivo ou um contacto para o pessoal nem para a outra empresa (`isolation.test.ts`).
- Uma aba antiga não grava depois de outra mudar de contexto: nada fica gravado em nenhum workspace (`workspace-guard.spec.ts`).

## Exceções documentadas

- `audit_logs`, `organization_members`, `organization_invitations` e `roles` têm `organization_id`, mas não são dados de um workspace; têm testes próprios em `rls.test.ts`.
- `ai_conversations`, `ai_digests` e `notifications` pertencem a uma pessoa (`user_id` obrigatório), com a organização opcional.
- Ações da conta ou da plataforma sem guarda de workspace (mudar de contexto, criar organização, perfil, preferências, áreas do menu, aceitar convite, apagar conta, notificações, consentimento da IA, push por aparelho, agente de mercado e confirmação de transferências pelo administrador): lista em `workspace-guard-coverage.test.ts`.

## E2E fora de produção

Os E2E podem correr numa instância local ligada ao Supabase (`E2E_BASE_URL=http://localhost:3000`). Precisam de `E2E_SUPABASE_URL` e `E2E_SUPABASE_SECRET_KEY`, só no terminal, e criam contas de teste que apagam no fim. Os testes da IA e do resumo do centro de inteligência precisam da chave do Gemini no servidor.
