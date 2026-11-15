# Motor de preços

**Estado: não iniciado (Fases 3–4).**

## Já disponível
`packages/financial-engine` tem as primitivas exatas que os orçamentos vão usar: `multiply` (quantidade × preço), `percentOf`, `priceFromMargin`, `priceFromMarkup`, `marginPercent`, `markupPercent` e `allocate`.

## Desenho previsto
- `packages/pricing-engine`: composição de orçamentos (materiais, mão de obra, deslocação, equipamentos, custos indiretos, margem e impostos via `tax-engine`), com cada linha rastreável.
- Referências de preço com fonte, data, país, região, categoria, unidade, valor, moeda e metodologia, apresentadas como **intervalo** quando a amostra é insuficiente.
- Fontes prioritárias: INE, Eurostat, IBGE, World Bank, OECD e fornecedores autorizados. Não se faz scraping que viole termos de utilização.
- Um preço nacional nunca é apresentado como local, e um preço nunca é dito "de mercado" sem evidência.
