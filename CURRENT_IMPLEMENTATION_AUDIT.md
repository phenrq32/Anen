# ANEN · Auditoria do estado atual (prompt 03)

_16/11/2026. Base: commit `7bfe01c`, produção em https://anen-five.vercel.app. Verificado no código, na base de dados de produção e com 16 testes E2E contra produção._

## Método

1. Rotas listadas a partir do build (`next build`) e da navegação (`components/app-shell.tsx`).
2. Procura de dados fictícios: valores monetários fixos, "demo", "mock", "fake", "sample", `localStorage`. **Nenhum resultado.**
3. Botões: todos os `<button>` têm `type="submit"` num formulário ligado a uma Server Action, ou `onClick`. Não há `href="#"`.
4. Formulários: todos chamam Server Actions que validam com Zod e gravam no Postgres (Supabase), com RLS.
5. Gráficos e indicadores: vêm das funções SQL `finance_monthly`, `finance_by_category` e `account_balances` e das tabelas, nunca de valores no código.
6. Testes: 162 unitários, de RLS e de integridade (PGlite com as migrations reais), mais 16 E2E contra produção em desktop e telemóvel.

> **Sobre valores como "Saldo atual 1.500 €":** não existe nenhum valor destes no código. O que o painel mostra é calculado a partir das contas e movimentos registados na conta com que se entrou. Se aparecer um valor que não reconhece, é dado registado nessa conta (por exemplo, o saldo inicial de uma conta). Sem dados, as páginas mostram estados vazios com a ação para começar.
>
> Atenção ao endereço: `anen-dimrm6nbn-anen1.vercel.app` é um deploy antigo e fixo. A versão atual é sempre **anen-five.vercel.app**.

## 1. Páginas existentes

| Área | Rotas | Estado |
|---|---|---|
| Autenticação | `/entrar`, `/criar-conta`, `/recuperar-acesso`, `/nova-senha`, `/auth/*`, `/boas-vindas`, `/convite/[token]` | Funcional, E2E |
| Painel | `/painel` | Funcional (dados reais: KPIs, gráfico de 12 meses, a receber/a pagar, projetos, orçamentos recentes, atividade) |
| Finanças | `/financas` (resumo), `/movimentos`, `/em-aberto`, `/plano`, `/contas`, `/orcamentos` (limites por categoria e objetivos), `/recorrentes`, `/categorias`, `/centros-de-custo`, `/exportar` (CSV) | Funcional, com lacunas abaixo |
| Orçamentos | `/orcamentos`, `/orcamentos/novo`, `/orcamentos/[id]`, `/imprimir/orcamento/[id]` | Funcional, com lacunas abaixo |
| Fichas técnicas | `/restauracao`, `/restauracao/[id]` | Funcional, E2E |
| Projetos | `/projetos`, `/projetos/[id]` | Funcional, E2E |
| Clientes e fornecedores | `/contactos`, `/contactos/[id]` | Funcional, com lacunas abaixo |
| Organização | `/organizacao`, `/membros`, `/funcoes`, `/organizacoes/nova` | Funcional, E2E |
| Definições | `/definicoes` | Funcional |

## 2. Funcionalidades que funcionam (persistem, calculam e têm testes)

- **Contas, receitas e despesas:** criar, editar, eliminar com confirmação, categorizar. Ligação a cliente ou fornecedor, projeto, centro de custo e tipo de custo. Vencimento, imposto incluído, estado pendente, parcial ou liquidado, método de pagamento e n.º de documento.
- **Indicadores:** o saldo por conta e o resumo mensal contam o valor **liquidado** (caixa). O resultado do mês (receitas − despesas) é separado do saldo bancário. A receber e a pagar mostra os vencidos e permite marcar como liquidado.
- **Recorrentes:** criar, ativar/desativar e eliminar. Geração idempotente.
- **Limites mensais por categoria, objetivos de poupança, exportação CSV** (protegida contra injeção de fórmulas).
- **Plano do mês:** salário, despesas fixas editáveis e orientação para a sobra, com fontes oficiais.
- **Orçamentos:** linhas por tipo (material, mão de obra, deslocação, equipamento, indiretos), quantidades, custos, margem, imposto, totais, versões imutáveis, estados (rascunho, enviado, aceite, recusado, expirado, cancelado), bloqueio após aceite, documento imprimível/PDF sem custos internos e conversão do orçamento aceite em projeto.
- **Projetos:** custo e receita previstos, custo real (atualizado sozinho quando se liga uma despesa), receita faturada e recebida, lucro e margem previstos e reais, desvio por tipo de custo e alerta de ultrapassagem.
- **Clientes e fornecedores:** cadastro com dados fiscais, contactos e observações; ficha com vendas, compras, valor em aberto, movimentos e projetos.
- **Fichas técnicas:** ingredientes, desperdício, custos indiretos, food cost, preço mínimo e recomendado, histórico de custo.
- **Organizações e permissões:** RBAC com hierarquia, convites e auditoria. Dados pessoais e de empresa separados por RLS.

## 3. Parcialmente funcionais

| Funcionalidade | O que falta | Fase |
|---|---|---|
| Recorrentes | ~~Só eram geradas quando alguém abria Finanças~~ (corrigido na Fase 1: tarefa diária no servidor). Não se podem editar (só ativar, desativar ou eliminar). Não têm cliente, projeto nem estado pendente. | 1 (servidor), 2 (resto) |
| Despesas | Não há anexos (faturas e recibos): só o n.º de documento. | 2 |
| Orçamentos | O cliente é texto livre, sem ligação ao cadastro, por isso a ficha do cliente não mostra os orçamentos. Não há descontos. As linhas não distinguem produto de serviço vendido. | 4 |
| Fornecedores | Há histórico de compras (movimentos), mas não há histórico de **preços por produto**. | 6 e 8 |
| Projetos | Não têm campo de descrição. O "prazo" é a data de fim. | 4 |
| Fluxo de caixa | Há o histórico mensal (12 meses), mas não há previsão a partir dos vencimentos futuros. | 9 |

## 4. Funcionalidades apenas visuais

**Nenhuma página ou botão simula uma operação.** Os únicos textos que anunciam algo não disponível são honestos e estão marcados como tal:
- No painel, "Pedidos de serviço": diz que o marketplace ainda não existe.
- Nas definições, a validação do NIF/CPF/CNPJ junto da autoridade fiscal: diz que só se valida o formato.
- Restos de tradução sem uso (`dashboard.quotesNotActive`) diziam que os orçamentos "chegam numa próxima versão". Ninguém os mostra, mas são removidos na Fase 1.

## 5. Funcionalidades inexistentes

| Área do prompt 03 | Estado | Dependência externa |
|---|---|---|
| Pesquisa de mercado e monitorização de preços | Não existe | Fontes com API ou licença. Sem elas: só preços registados pelo próprio utilizador (compras, cotações). |
| ANEN AI | Não existe | Chave de API de um modelo (ex.: Anthropic) e limite de custo mensal |
| Compras e inventário | Não existe | — |
| Relatórios (além do resumo e CSV) | Não existe | — |
| Notificações e automações | Não existe | Email: SMTP/fornecedor de envio |
| Anexos | Não existe | Supabase Storage (já disponível) |

Estas áreas **não aparecem no menu**, por isso nenhuma surge como pronta.

## 6. Problemas técnicos encontrados

1. **Sem tarefas no servidor.** Os recorrentes dependem de uma visita à página. A monitorização de preços, os alertas e os resumos da IA vão precisar do mesmo agendador. O `pg_cron` está disponível no projeto Supabase, mas não está instalado.
2. **Sem registo de execução de tarefas** (início, fim, erro e quantidade processada) para monitorizar.
3. **O orçamento não está ligado ao cadastro de clientes** (texto livre), o que quebra o histórico comercial do cliente.
4. **Tipos mantidos à mão** (`packages/types/src/database.ts`). Funciona, mas deve passar a `supabase gen types` quando houver CI com acesso ao projeto.
5. **Deploy manual pela CLI.** Não há ligação GitHub → Vercel; cada publicação precisa de token.
6. **Credenciais coladas no chat** (Supabase e Vercel) devem ser revogadas e substituídas por variáveis guardadas no ambiente de CI.

## 7. Arquitetura que se mantém

- Next.js (App Router, Server Components e Server Actions) em `apps/web`, publicado na Vercel.
- Supabase: Postgres com RLS em todas as tabelas, RPC `SECURITY DEFINER`/`INVOKER` com `search_path` vazio e Auth.
- Pacotes partilhados: `financial-engine` (dinheiro em `bigint`, cálculos determinísticos), `validation` (Zod), `i18n` (pt-PT e pt-BR), `types`, `ui`, `database` (testes PGlite).
- A IA, quando existir, chama ferramentas no servidor que usam estes motores. Nunca calcula sozinha.

## 8. Plano

| Fase | Conteúdo | Estado |
|---|---|---|
| **1** | Auditoria (este documento). Agendador no servidor (`pg_cron`, 05:00 UTC) com registo de execuções (`job_runs`) e geração diária dos recorrentes de todas as pessoas e organizações. Limpeza de textos obsoletos. | **Concluída**: migration 0900 em produção, tarefa agendada e executada com sucesso, `scheduler.test.ts` |
| 2 | Recorrentes editáveis e com cliente/projeto/pendente; anexos de faturas e recibos (Storage com RLS) | **Concluída**: migration 1000 em produção, `recurring-attachments.test.ts`, E2E `recurring-attachments.spec.ts` |
| 3 | CRM: observações datadas, orçamentos e pendentes na ficha, histórico de preços por fornecedor | **Concluída**: migration 1100 em produção, `crm.test.ts`, `price-history.test.ts`, E2E `crm.spec.ts`. O orçamento já fica ligado ao cadastro (antecipado da Fase 4) |
| 4 | ~~Orçamentos ligados ao cadastro de clientes~~ (feito na Fase 3), descontos, produtos/serviços; descrição do projeto | **Concluída** localmente: migration 1200, `quote-discounts.test.ts`, E2E `quote-discounts.spec.ts` (por publicar) |
| 5 | Fichas técnicas ligadas a preços de ingredientes registados | **Concluída** localmente: migration 1300, `recipe-prices.test.ts`, E2E `recipe-prices.spec.ts` (por publicar) |
| 6 | Inteligência de mercado: fontes, recolha agendada, histórico, comparação, alertas | Pendente (fontes externas) |
| 7 | ANEN AI com ferramentas, histórico de conversas por organização | Bloqueada (chave de API) |
| 8 | Compras, inventário e automações | Pendente |
| 9 | Relatórios, notificações, otimização | Pendente |
