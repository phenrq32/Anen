# ANEN: instruções para o Claude Code

Plataforma SaaS de finanças pessoais e empresariais, orçamentos, pesquisa de preços, fiscalidade, IA, marketplace de serviços e assinaturas (Free, Pro e Max). Mercados iniciais: Portugal e Brasil, com uma arquitetura que permita acrescentar outros países.

> Este projeto substituiu o antigo conceito "ANEN Business Financing" (crédito a empresas), que foi abandonado em 15/11/2026.

## Ler antes de mudar código
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): o que existe e o que está bloqueado.
- [ARCHITECTURE.md](ARCHITECTURE.md) e [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
- [SECURITY.md](SECURITY.md).

## Regras inegociáveis
- **Segurança na base de dados.** Toda a tabela nova tem RLS, `organization_id` quando o dado pertence a uma organização, e políticas por `private.has_org_permission`. As escritas sensíveis passam por RPC `SECURITY DEFINER` com `set search_path = ''`. Revogar os privilégios por omissão a `anon` e `authenticated`.
- **Testar acessos cruzados.** Cada tabela nova tem testes em `packages/database/tests` que provam que outra organização e os anónimos não leem nem escrevem.
- **Dinheiro.** Usar sempre `@anen/financial-engine` (`Money` em unidades mínimas `bigint`). Nunca usar `number` para valores monetários e nunca misturar moedas.
- **Fiscalidade, preços e limites ficam em dados versionados** (com fonte legal e datas de vigência), nunca em código. Não inventar taxas, fontes nem preços.
- **Não simular.** Sem dados fictícios, sem botões sem ação, sem integrações falsas. Se algo não está disponível, a UI diz isso.
- **IA.** A IA chama funções determinísticas para cálculos, cita fontes e datas, e distingue estimativa de valor confirmado.
- **TypeScript estrito, sem `any`.** Validar com Zod no servidor e na base de dados.
- **Textos.** Toda a interface passa por `@anen/i18n`, com pt-PT e pt-BR (as chaves têm de coincidir, e há um teste para isso). Os erros SQL levantam chaves de `messages.errors`.
- **Não marcar nada como concluído sem testes a passar.** Atualizar `IMPLEMENTATION_STATUS.md` e `CHANGELOG.md` no fim de cada fase.

## Marca
- Preto `#090909` (fundo), branco `#FFFFFF`, laranja `#FF851B` (ações principais, valores relevantes, elementos ativos), cinzas `#202020` e `#353535`.
- O botão laranja leva texto preto. Não usar laranja em texto pequeno sobre fundo branco.
- Títulos em Manrope e texto em Inter. Cantos de 12 a 20 px, bordas finas, sem excesso de gradientes nem sombras, e sem emojis.
- Os números financeiros aparecem formatados por locale (`formatMoney`) e alinhados à direita em tabelas (`.tabular`).
- Logótipo em `apps/web/public/logo.svg` e ícone em `apps/web/src/app/icon.svg`. Os tokens estão em `packages/ui`.

## Comandos
`npm test` · `npm run typecheck` · `npm run build` · `npm run dev`
