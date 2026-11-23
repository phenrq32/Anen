# Arquitetura Dual (Pessoal e Empresarial)

Uma conta ANEN, uma identidade visual e uma infraestrutura, com dois tipos de espaço de trabalho e os dados rigorosamente separados.

| Documento | Conteúdo |
|---|---|
| [DUAL_ARCHITECTURE_AUDIT.md](DUAL_ARCHITECTURE_AUDIT.md) | Auditoria inicial, lacunas, zona visual protegida e a decisão da opção A |
| [WORKSPACE_DATA_MODEL.md](WORKSPACE_DATA_MODEL.md) | Vistas, funções, correspondência com o prompt e reversão |
| [QA_REVIEW.md](QA_REVIEW.md) | Problemas encontrados e o seu estado |
| [TESTING_DUAL_WORKSPACES.md](TESTING_DUAL_WORKSPACES.md) | Como se prova o isolamento |

## Princípios

1. **O workspace ativo decide-se no servidor.** Vem da sessão (`user_preferences.active_organization_id`, validado por gatilho), nunca de um valor enviado pelo cliente sem validação (`resolveWorkspace`).
2. **A autorização está na base de dados.** O RLS de cada tabela, `private.has_org_permission` e `private.can_access_workspace` aplicam-se mesmo que a interface falhe.
3. **Cada registo pertence a um único workspace** (`owner_user_id` ou `organization_id`), que não muda numa edição.
4. **Não se migram dados.** A camada de workspaces é feita de vistas e funções sobre o modelo existente.
5. **Uma gravação só acontece no workspace que estava no ecrã.** Cada formulário envia a chave do workspace (`__workspace`) e cada ação começa por `guardWorkspace`. Sem a chave, ou com uma diferente da ativa, nada é gravado (falha fechada).

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | Opção A: vistas `workspaces` e `workspace_members` em vez de uma tabela nova com `workspace_id` | O isolamento já existia e estava testado; migrar 35 tabelas trazia risco sem ganho de segurança |
| D2 | Id do workspace pessoal = id do utilizador | Os registos pessoais já usam `owner_user_id`; não é preciso uma tabela nem uma chave nova |
| D3 | Organizações `business` e `independent` são ambas `BUSINESS` | São atividades profissionais; o `organization_kind` continua disponível para a interface |
| D4 | Sem tabela `workspace_settings` | As definições já estão em colunas validadas (`user_preferences`, `organizations`, `notification_settings`) |
| D5 | O contexto continua a ser uma preferência no servidor; os formulários levam a chave do workspace | Resolve o QA-03 (duas abas) sem mudar os endereços; o contexto no endereço fica para a Fase 4 |
| D6 | Guarda `workspace_immutable` única em todas as tabelas | Uma regra em vez de uma por tabela; o teste de isolamento exige-a também nas tabelas futuras |
| D7 | Contexto não vai para o endereço (`/app/pessoal/...`) | Mudaria os 49 endereços e todos os links e E2E. O risco que resolveria (dados ou gravações do contexto errado) já está coberto pela guarda de gravação, pela sincronização entre abas e pelo estado reposto ao mudar de workspace |
| D8 | Módulos de empresa no pessoal só com dados pessoais | Não esconder trabalho existente de quem já usava orçamentos ou projetos no pessoal |

## Estado das fases

| Fase | Estado |
|---|---|
| 1. Auditoria e revisão | Concluída |
| 2. Workspaces, conta única e membros | Concluída; migration 2700 aplicada em produção a 23/11/2026 |
| 3. Separação dos dados e segurança no servidor | Concluída; em produção a 23/11/2026 |
| 4. Seletor de contexto e navegação adaptativa | Concluída; em produção a 23/11/2026 |
| 5–10 | Por iniciar |
