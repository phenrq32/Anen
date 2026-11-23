# Revisão de QA

_Fase 1 · 23/11/2026._ Arquitetura em [DUAL_ARCHITECTURE_AUDIT.md](DUAL_ARCHITECTURE_AUDIT.md).

## Como foi feita

| Verificação | Resultado |
|---|---|
| `npm test` | **409 testes a passar** (51 ficheiros), incluindo os 16 novos de `open-items.test.ts` |
| `npm run typecheck` (TypeScript estrito, todos os workspaces) | Sem erros |
| `npm run build` | Sem erros nem avisos (49 páginas) |
| E2E (Playwright, Chromium desktop e Pixel 7) | **10 a passar**: `open-items`, `finance`, `business` e `recurring-attachments`. Correram com o código desta fase numa instância local ligada ao Supabase de produção (sem migrações novas; a produção está na migration 2600, a mesma do repositório). As contas de teste são apagadas no fim |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `any`, `TODO`, `FIXME` no código-fonte | Nenhum |
| Consultas a tabelas com âmbito sem filtro de contexto (análise estática das 17 `actions.ts` e de `lib/`) | Ver QA-05 |
| Service worker | Não guarda páginas nem dados (só ficheiros públicos), por isso não há fuga entre contas nem contextos |
| Identidade visual | Sem alterações (`git diff` vazio nos ficheiros da zona protegida) |

**Limites desta revisão.** Corri no browser só os E2E das áreas alteradas, não os 25 ficheiros. A revisão página a página no browser (desktop, tablet e telemóvel) fica para a revisão completa da Fase 10, idealmente em staging (QA-08).

## Problemas encontrados

Gravidade: crítico · alto · médio · baixo. Estado: **corrigido** (com teste) · corrigido sem teste automático · pendente · decisão sua.

| ID | Local | Problema | Gravidade | Estado |
|---|---|---|---|---|
| QA-01 | `/financas/em-aberto` | Não se conseguia introduzir valores em "A Receber" e "A Pagar" | Crítico | **Corrigido** |
| QA-02 | `financas/actions.ts#deleteTransactionAction` | Os anexos eram apagados do Storage antes de se confirmar que o movimento era do contexto ativo, o que podia levar à perda de ficheiros | Alto | **Corrigido** |
| QA-03 | Contexto ativo (`user_preferences.active_organization_id`) | Com duas abas em contextos diferentes, um formulário grava no contexto ativo no momento de gravar, não no que estava no ecrã | Alto | Pendente (Fase 3/4) |
| QA-04 | Menu (`components/app-shell.tsx`) | O espaço pessoal mostra os módulos de empresa (Compras, Inventário, Faturação, Fichas técnicas) | Médio | Pendente (Fase 4) |
| QA-05 | `financas/importar/actions.ts:110` | As categorias são lidas sem filtro de contexto. A base de dados recusa categorias de outro espaço (`category_invalid`), mas a importação falharia inteira em vez de ignorar a categoria | Baixo | Pendente |
| QA-06 | Lançar receita ou despesa (registo rápido e Movimentos) | "Por pagar/Por receber" só existia escondido em "Mais detalhes" e não existia no registo rápido. Reportado pelo utilizador: "não consegui adicionar valores no a receber e a pagar" | Alto | **Corrigido** |
| QA-07 | `switchContextAction` | Se a gravação da preferência falhar, não mostra erro e vai para o painel no contexto antigo | Baixo | Corrigido na Fase 2 (sem teste automático do caminho de erro) |
| QA-08 | E2E | Correm contra produção e criam contas reais temporárias; falta staging | Médio | Decisão sua (precisa de um projeto Supabase de staging) |
| QA-09 | Repositório | Não há linter (ESLint ou equivalente); só `tsc` | Baixo | Pendente |
| QA-10 | "Marcar como liquidado" | Só liquida o total; um pagamento parcial regista-se editando o movimento | Baixo | Pendente (Fase 5/6, com as parcelas) |
| QA-12 | Bucket `attachments` (produção) | Até 2 PDFs de teste órfãos, deixados pela primeira versão do QA-02 durante os E2E (ver detalhe do QA-02) | Baixo | Decisão sua: limpar com uma tarefa de ficheiros órfãos (já prevista em `IMPLEMENTATION_STATUS.md`) |
| QA-11 | `deleteAttachmentAction` | O anexo era procurado sem filtro do contexto ativo (o RLS protegia, mas podia apagar o anexo de outro contexto da mesma pessoa) | Médio | **Corrigido** |

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
  - `e2e/open-items.spec.ts`: o fluxo completo na página (vírgula decimal e separador de milhares, parcial, editar, liquidar e eliminar), em desktop e telemóvel. **A passar.**

### QA-02 · Eliminar movimento apagava anexos antes de validar (alto, corrigido)

- **Cenário:** uma pessoa com acesso ao espaço pessoal e a uma organização carrega em Eliminar numa aba antiga, depois de ter mudado de contexto noutra aba. Os ficheiros do movimento eram apagados do Storage (o RLS permitia, porque é membro), mas o movimento não, porque não pertence ao contexto ativo. Ficava um movimento com anexos partidos.
- **Correção:** primeiro confirma-se que o movimento é do contexto ativo; se não for, nada é tocado e a resposta é "sem permissão". Depois removem-se os ficheiros (se a remoção falhar, o movimento fica) e só então se elimina o movimento.
- **Primeira tentativa errada, apanhada pelo teste:** eliminar o movimento antes dos ficheiros deixava os ficheiros órfãos, porque a política do Storage (`private.can_write_attachment_path`) só deixa apagá-los enquanto o movimento existe. O E2E novo detetou isto e a ordem foi corrigida. Nessa execução de teste podem ter ficado até 2 PDFs de teste (poucos bytes) órfãos no bucket `attachments` de produção, de contas de teste já apagadas. Não os removi: para os encontrar seria preciso listar o bucket inteiro, com ficheiros de clientes reais. Fica a decisão consigo (QA-12).
- **Teste:** `e2e/recurring-attachments.spec.ts` anexa um ficheiro, confirma no Storage que existe (pelo caminho exato do ficheiro do teste), elimina o movimento em "A pagar" e confirma que o ficheiro saiu do Storage. Desktop e telemóvel, a passar. O mesmo teste cobre o QA-11 (remover anexo).

### QA-03 · Contexto global entre abas (alto, pendente)

- **Cenário:** aba A em "Empresa X → Movimentos", aba B muda para Pessoal, e na aba A grava-se um movimento. O movimento fica no espaço Pessoal. Não é uma fuga entre contas, porque a pessoa tem acesso aos dois espaços, mas um dado fica no espaço errado.
- **Proposta (Fase 3/4):** o contexto passa a fazer parte do endereço (`/app/pessoal/…`, `/app/empresa/<slug>/…`, ou um campo oculto `workspace` em cada formulário), e o servidor recusa a gravação quando o contexto enviado não coincide com o que o utilizador pode usar.

## Revisão rápida no fim da Fase 2

Áreas afetadas: sessão, mudança de contexto e âmbitos de finanças, negócio e orçamentos.

- `npm test`: 429 a passar. `npm run typecheck`: sem erros. `npm run build`: sem erros.
- E2E na app local ligada a produção (sem a migration 2700, que a app só usa quando falta o espaço pessoal): `accounts`, `finance`, `business`, `open-items` e `notifications-reports`, 14 a passar em desktop e telemóvel.
- Identidade visual: `git diff` vazio na zona protegida.
- Nenhum problema novo.

## QA-06 · Estado do pagamento visível ao lançar (corrigido a 23/11/2026)

- **Pedido do utilizador:** poder escolher "a receber / a pagar" no momento de lançar uma receita ou despesa.
- **Correção:**
  - "Estado do pagamento" sai de "Mais detalhes" e fica sempre visível, logo a seguir ao valor, em Movimentos, em "A receber e a pagar" e no registo rápido (tecla N).
  - As opções dependem do tipo: despesa "Já pago / Por pagar / Pago em parte"; receita "Já recebido / Por receber / Recebido em parte". O registo rápido tem só as duas primeiras.
  - O vencimento aparece quando o valor ainda não foi pago, com uma nota a dizer que fica em "A receber e a pagar".
  - Na ação, o estado do pagamento é tratado à parte dos restantes detalhes: o registo rápido grava o estado sem apagar contacto, projeto nem imposto, e num movimento pago o vencimento antigo mantém-se.
- **Testes:** `e2e/open-items.spec.ts` alargado (registo rápido "Por pagar" com vencimento aparece em "A pagar"; opções de receita). `business`, `finance`, `notifications-reports` e `recurring-attachments` continuam a passar (10 E2E, desktop e telemóvel).
- **Nota:** `intelligence.spec.ts` falha localmente só no passo do resumo da IA, porque a app local não tem a chave do Gemini e mostra "IA não configurada". Os passos de lançamento desse teste passam.
- **Ainda não está em produção:** o site publicado continua na versão anterior até ao deploy.
