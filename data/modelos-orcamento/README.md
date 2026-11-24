# Modelos de orçamento 2026 — Portugal e Brasil

Pacote com os modelos de orçamento pré-prontos para as 19 categorias do app ANEN
(Agricultura, Automotivo, Hidráulica, Construção, Consultoria, Design, Educação, Elétrica,
Estética, Eventos, Limpeza, Marketing, Pintura, Reforma, Alimentação / buffet, Saúde,
Serviços domésticos, Tecnologia, Transportes).

| País     | Serviços | Moeda | Preço                                   |
|----------|---------:|-------|-----------------------------------------|
| Portugal |      334 | EUR   | **sem IVA** (somar 23% no continente)   |
| Brasil   |      408 | BRL   | **final ao cliente** (impostos inclusos) |

Edição atual: **2026-12** (revista a 24/11/2026: preços pela média nacional publicada e mais serviços). A edição 2026-11 fica em `dados/modelos_orcamento_2026-11.json`.

## Estrutura

```
modelos-orcamento/
├── CLAUDE.md                          ← instruções para o Claude Code
├── README.md
├── pdf/
│   ├── Modelos_Orcamento_2026_Portugal.pdf
│   └── Modelos_Orcamento_2026_Brasil.pdf
├── dados/
│   ├── modelos_orcamento_2026.json    ← JSON unificado (PT + BR) — usar este no site/app
│   ├── portugal/modelos.json | modelos.csv
│   └── brasil/modelos.json   | modelos.csv
└── scripts/
    ├── dados.py        ← fonte dos dados de Portugal
    ├── dados_br.py     ← fonte dos dados do Brasil
    ├── config.py       ← textos e caminhos por país
    ├── gerar.py        ← gera PDF + JSON + CSV de cada país
    └── fonts/          ← Fira Sans (licença OFL)
```

## Formato do JSON unificado

```json
{
  "versao": "2026-11",
  "paises": {
    "pt": { "pais": "Portugal", "moeda": "EUR", "impostos_inclusos": false, "categorias": [...] },
    "br": { "pais": "Brasil",   "moeda": "BRL", "impostos_inclusos": true,  "categorias": [...] }
  }
}
```

Cada categoria:

```json
{ "id": "construcao", "nome": "Construção",
  "linhas_de_custo": ["Materiais de construção", "Mão de obra (pedreiro)", "..."],
  "servicos": [ ... ] }
```

Cada serviço:

```json
{
  "id": "construcao__parede-de-drywall-2-faces-c-isolamento",
  "nome": "Parede de drywall 2 faces c/ isolamento",
  "unidade": "m²",
  "preco_recomendado": 130,
  "faixa_min": 95,
  "faixa_max": 180,
  "materiais": "Chapas de gesso 12,5 mm, perfis, lã de vidro/rocha, fita e massa",
  "nota": "Chapa RU (verde) para áreas úmidas",
  "composicao": [
    { "linha": "Materiais de construção", "valor": 70 },
    { "linha": "Mão de obra (pedreiro)",  "valor": 45 },
    { "linha": "Mão de obra (servente)",  "valor": 10 },
    { "linha": "Aluguer de equipamento",  "valor": 3 },
    { "linha": "Deslocação / entulho",    "valor": 2 }
  ]
}
```

Regra: `preco_recomendado` = soma de `composicao[].valor` (por unidade).

## Regenerar PDFs e dados

```bash
pip install reportlab
cd scripts
python3 gerar.py pt   # Portugal
python3 gerar.py br   # Brasil
```

Para alterar um preço, edite `dados.py` ou `dados_br.py` (os valores são a composição;
o preço recomendado é calculado) e rode o script de novo.
O JSON unificado em `dados/modelos_orcamento_2026.json` precisa ser regenerado à parte
(ver instruções em `CLAUDE.md`).

## Aviso

Valores indicativos baseados em pesquisa de mercado de novembro de 2026 (fontes listadas na
última página de cada PDF). Cada profissional deve ajustar à sua região e custos.
Não constitui aconselhamento fiscal.
