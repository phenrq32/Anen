# Revisão de QA

_Fase 1 · 23/11/2026._ Arquitetura em [DUAL_ARCHITECTURE_AUDIT.md](DUAL_ARCHITECTURE_AUDIT.md).

## Como foi feita

| Verificação | Resultado |
|---|---|
| `npm test` | **409 testes a passar** (51 ficheiros), incluindo os 16 novos de `open-items.test.ts` |
| `npm run typecheck` (TypeScript estrito, todos os workspaces) | Sem erros |
| `npm run build` | Sem erros nem avisos (49 páginas) |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `any`, `TODO`, `FIXME` no código-fonte | Nenhum |
| Consultas a tabelas com âmbito sem filtro de contexto (análise estática das 17 `actions.ts` e de `lib/`) | Ver QA-05 |
| Service worker | Não guarda páginas nem dados (só ficheiros públicos), por isso não há fuga entre contas nem contextos |
| Identidade visual | Sem alterações (`git diff` vazio nos ficheiros da zona protegida) |

**Limites desta revisão.** O contentor de desenvolvimento não tem acesso ao Supabase nem às chaves de E2E. Por isso, desta vez não percorri as páginas no browser nem corri os E2E (que correm contra produção). A revisão foi feita por código, testes de base de dados e build. A revisão no browser (desktop, tablet e telemóvel) e os E2E ficam para quando houver um ambiente de staging (QA-08) ou para correr contra produção, com a sua autorização.

## Problemas encontrados

Gravidade: crítico · alto · médio · baixo. Estado: **corrigido** (com teste) · corrigido sem teste automático · pendente · decisão sua.

| ID | Local | Problema | Gravidade | Estado |
|---|---|---|---|---|
| QA-01 | `/financas/em-aberto` | Não se conseguia introduzir valores em "A Receber" e "A Pagar" | Crítico | **Corrigido** |
| QA-02 | `financas/actions.ts#deleteTransactionAction` | Os anexos eram apagados do Storage antes de se confirmar que o movimento era do contexto ativo, o que podia levar à perda de ficheiros | Alto | Corrigido sem teste automático |
| QA-03 | Contexto ativo (`user_preferences.active_organization_id`) | Com duas abas em contextos diferentes, um formulário grava no contexto ativo no momento de gravar, não no que estava no ecrã | Alto | Pendente (Fase 3/4) |
| QA-04 | Menu (`components/app-shell.tsx`) | O espaço pessoal mostra os módulos de empresa (Compras, Inventário, Faturação, Fichas técnicas) | Médio | Pendente (Fase 4) |
| QA-05 | `financas/importar/actions.ts:110` | As categorias são lidas sem filtro de contexto. A base de dados recusa categorias de outro espaço (`category_invalid`), mas a importação falharia inteira em vez de ignorar a categoria | Baixo | Pendente |
| QA-06 | Registo rápido (tecla N) | Não permite marcar um valor como pendente; só "pago" | Baixo | Pendente: agora resolve-se em "A receber e a pagar". Decisão sua: acrescentar ou não |
| QA-07 | `switchContextAction` | Se a gravação da preferência falhar, não mostra erro e vai para o painel no contexto antigo | Baixo | Pendente |
| QA-08 | E2E | Correm contra produção e criam contas reais temporárias; falta staging | Médio | Decisão sua (precisa de um projeto Supabase de staging) |
| QA-09 | Repositório | Não há linter (ESLint ou equivalente); só `tsc` | Baixo | Pendente |
| QA-10 | "Marcar como liquidado" | Só liquida o total; um pagamento parcial regista-se editando o movimento | Baixo | Pendente (Fase 5/6, com as parcelas) |
| QA-11 | `deleteAttachmentAction` | O anexo era procurado sem filtro do contexto ativo (o RLS protegia, mas podia apagar o anexo de outro contexto da mesma pessoa) | Médio | Corrigido sem teste automático |

## Detalhe

### QA-01 · "A Receber" e "A Pagar": não era possível introduzir valores (crítico, corrigido)

- **Reproduzir (antes):** Finanças → A receber e a pagar. A página só listava os valores. Não havia formulário, nem forma de editar ou apagar.
- **Causa:** a base de dados e a ação do servidor aceitam valores pendentes e parciais, e isso já estava testado. A falha estava na interface. A única forma de criar um valor em aberto era ir a Movimentos, abrir "Mais detalhes" (fechado por omissão) e mudar "Estado do pagamento" para Pendente. Também só se editava um movimento se ele estivesse no mês selecionado em Movimentos.
- **Correção:**
  - A página tem agora o formulário "Registar valor a receber ou a pagar". Vem já como Pendente e com os detalhes abertos; Receita é a receber e Despesa é a pagar; `?tipo=income` abre em Receita. Reutiliza o formulário e a ação de movimentos, com a mesma validação Zod e no servidor.
  - Cada linha tem "Editar" (abre o movimento no mês certo), "Eliminar" e "Marcar como liquidado".
  - Sem nenhuma conta, a página explica o que falta e leva a "Criar conta", em vez de mostrar um formulário que não pode gravar.
  - Funciona no espaço pessoal e no de organização. O leitor (sem `finance.write`) continua só a ver.
- **Testes:**
  - `packages/database/tests/open-items.test.ts` (16 testes, a passar): criar pendente e parcial, saldo só com o liquidado, editar mantém pendente, liquidar, eliminar, nos dois espaços. Inclui acessos cruzados: outra pessoa não vê, não liquida nem apaga mesmo com o identificador; ninguém grava no espaço de outro; os dados pessoais da proprietária não aparecem aos membros da organização; o leitor não escreve; o âmbito não muda numa edição; os anónimos são recusados.
  - `e2e/open-items.spec.ts`: o fluxo completo na página (vírgula decimal e separador de milhares, parcial, editar, liquidar e eliminar), em desktop e telemóvel. **Escrito, mas por correr:** precisa das chaves de E2E (ver "Limites").

### QA-02 · Eliminar movimento apagava anexos antes de validar (alto, corrigido sem teste automático)

- **Cenário:** uma pessoa com acesso ao espaço pessoal e a uma organização carrega em Eliminar numa aba antiga, depois de ter mudado de contexto noutra aba. Os ficheiros do movimento eram apagados do Storage (o RLS permitia, porque é membro), mas o movimento não, porque não pertence ao contexto ativo. Ficava um movimento com anexos partidos.
- **Correção:** o movimento é apagado primeiro, com o filtro do contexto ativo e a confirmação de que foi mesmo eliminado. Só depois se removem os ficheiros. Se nada foi apagado, devolve "sem permissão".
- **Teste em falta:** a ação usa o Storage do Supabase, que os testes de PGlite não emulam. Fica para um E2E de anexos (Fase 3).

### QA-03 · Contexto global entre abas (alto, pendente)

- **Cenário:** aba A em "Empresa X → Movimentos", aba B muda para Pessoal, e na aba A grava-se um movimento. O movimento fica no espaço Pessoal. Não é uma fuga entre contas, porque a pessoa tem acesso aos dois espaços, mas um dado fica no espaço errado.
- **Proposta (Fase 3/4):** o contexto passa a fazer parte do endereço (`/app/pessoal/…`, `/app/empresa/<slug>/…`, ou um campo oculto `workspace` em cada formulário), e o servidor recusa a gravação quando o contexto enviado não coincide com o que o utilizador pode usar.
