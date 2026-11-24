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

/** Limite de serviços num orçamento criado a partir de vários modelos de uma vez. */
export const SERVICE_MODEL_MAX_SELECTION = 40;
/** Limite de texto de uma linha de orçamento (igual ao da base de dados). */
const LINE_DESCRIPTION_MAX = 300;

/**
 * Vários serviços de uma vez: as linhas de cada serviço, pela ordem escolhida, cada uma com a sua
 * quantidade. Com mais de um serviço, cada linha começa pelo nome do serviço ("Pintura · Tinta")
 * para o orçamento continuar legível. Total sem imposto = Σ preço recomendado × quantidade.
 */
export function quoteLinesFromServiceModels(
  items: readonly { name: string; unit: string; composition: readonly ServiceModelLine[]; quantity: string }[],
): ServiceModelQuoteLine[] {
  const many = items.length > 1;
  return items.flatMap((item) =>
    quoteLinesFromServiceModel(item, item.quantity).map((l) => ({
      ...l,
      description: many ? `${item.name} · ${l.description}`.slice(0, LINE_DESCRIPTION_MAX) : l.description,
    })),
  );
}
