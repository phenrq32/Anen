# Motor fiscal

**Estado: não iniciado (Fase 5).** Nenhuma taxa fiscal está codificada no sistema.

## Já disponível
- Jurisdições base em `regions`: Portugal continental, Açores e Madeira; 26 estados e o DF.
- Validação estrutural de NIF/NIPC, CPF e CNPJ (incluindo o alfanumérico). Não confirma titularidade nem situação cadastral.

## Desenho previsto
- Pacote `packages/tax-engine`, determinístico e sem I/O, que recebe regras e devolve o cálculo com o registo de cada regra aplicada.
- Tabelas `tax_jurisdictions`, `tax_regimes`, `tax_rules`, `tax_rule_versions`, `tax_rates`, `tax_exemptions` e `tax_calculation_logs`.
- Cada regra regista país, jurisdição, atividade (CAE/CNAE), tipo de operação, regime, taxa, exceções, início e fim de vigência, fonte legal e data de validação.
- Uma regra sem validação nunca é aplicada automaticamente. O sistema pede os dados em falta e não presume nada.
- O Brasil exige suporte à transição CBS/IBS de 2026 a 2033, com versões por data.
- Os resultados são sempre apresentados como estimativa até haver validação profissional.
