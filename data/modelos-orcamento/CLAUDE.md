# CLAUDE.md — Modelos de orçamento (ANEN)

## Contexto
Este pacote contém os **modelos de orçamento pré-prontos** do app ANEN para Portugal (EUR, sem IVA)
e Brasil (BRL, impostos inclusos). O objetivo é publicá-los no site/app para que o utilizador:

1. escolha uma **categoria** (ex.: Construção);
2. escolha um **serviço** (ex.: Parede de drywall);
3. receba o orçamento **pré-preenchido**: unidade, preço recomendado, faixa de mercado,
   materiais/produtos e a divisão do valor pelas **linhas de custo** da categoria.

O utilizador informa a quantidade (m², horas, unidades…) e o total = `preco_recomendado × quantidade`
(+ IVA em Portugal, quando aplicável).

## Fonte de verdade
- `dados/modelos_orcamento_2026.json` → arquivo a consumir no site/app (PT + BR).
- `scripts/dados.py` e `scripts/dados_br.py` → onde os dados são editados.
- Os nomes em `linhas_de_custo` são **idênticos** aos usados no app (não traduzir nem renomear sem
  pedir: ex. "Deslocação", "Aluguer de equipamento", "Portagens / pedágios").

## Regras
- `preco_recomendado` é sempre a soma de `composicao[].valor`. Nunca editar um sem o outro.
- `faixa_min ≤ preco_recomendado ≤ faixa_max` (o `unificar.py` valida).
- `id` é estável (slug de categoria + serviço); não mudar ids de serviços já publicados.
- Portugal: `impostos_inclusos: false` → mostrar "sem IVA" e oferecer somar 23%.
- Brasil: `impostos_inclusos: true` → mostrar como preço final.
- Formatação de moeda: PT `1 300,00 €` · BR `R$ 1.300,00`.
- Não alterar preços por iniciativa própria; mudanças de valores são decisão do dono do app.

## Comandos
```bash
pip install reportlab
cd scripts
python3 gerar.py pt      # PDF + JSON + CSV de Portugal
python3 gerar.py br      # PDF + JSON + CSV do Brasil
python3 unificar.py      # JSON unificado em dados/
```

## Tarefas sugeridas
- Importar o JSON unificado para a base de dados do app (tabelas: paises, categorias,
  linhas_de_custo, servicos, composicao) ou servi-lo como ficheiro estático.
- Criar o seletor Categoria → Serviço no fluxo do botão "+" do app.
- Pré-preencher as linhas do orçamento com `composicao` e permitir que o profissional edite.
- Mostrar a faixa de mercado como referência ("Mercado: X – Y").
- Disponibilizar os PDFs de `pdf/` para download no site.
