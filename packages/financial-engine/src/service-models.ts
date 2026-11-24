import { defaultNature, type QuoteLineKind, type QuoteLineNature } from "./quote";

/**
 * Modelos de orçamento com preços (pacote do dono da app, 2026-11). A composição divide o PREÇO
 * recomendado por unidade pelas linhas de custo da categoria; o preço já inclui a margem do profissional.
 * Por isso, um orçamento criado a partir de um modelo começa com margem 0 %: total sem imposto =
 * preço recomendado × quantidade. O profissional pode depois editar linhas e margem.
 */
export interface ServiceModelLine {
  line: string;
  kind: QuoteLineKind;
  amountMinor: bigint;
}

export interface ServiceModelQuoteLine {
  kind: QuoteLineKind;
  nature: QuoteLineNature;
  description: string;
  /** Quantidade decimal exata (texto, como no editor). */
  quantity: string;
  unit: string;
  unitCostMinor: bigint;
}

/** Margem com que começa um orçamento criado a partir de um modelo com preço. */
export const SERVICE_MODEL_MARGIN_PERCENT = "0";

export function quoteLinesFromServiceModel(model: { unit: string; composition: readonly ServiceModelLine[] }, quantity: string): ServiceModelQuoteLine[] {
  return model.composition.map((c) => ({
    kind: c.kind,
    nature: defaultNature(c.kind),
    description: c.line,
    quantity,
    unit: model.unit,
    unitCostMinor: c.amountMinor,
  }));
}
