import { allocateLinePrices, moneyFromMinor } from "@anen/financial-engine";
import type { QuoteItemNature } from "@anen/types";

/**
 * Documento do orçamento para o cliente (página para imprimir e PDF): mostra PREÇOS, nunca custos internos
 * nem margem. O preço antes do desconto é repartido pelas linhas na proporção do custo, sem perder cêntimos.
 * As linhas seguidas com a mesma secção formam um grupo (o serviço), com subtotal.
 */
export interface DocumentLineInput {
  id: string;
  section: string | null;
  description: string;
  nature: QuoteItemNature;
  /** Quantidade decimal (texto ou número como vem da base). */
  quantity: string | number;
  unit: string | null;
  totalCostMinor: bigint;
}

export interface DocumentLine {
  id: string;
  description: string;
  nature: QuoteItemNature;
  /** Quantidade como texto decimal com ponto ("12.5"), sem zeros à direita. */
  quantity: string;
  unit: string | null;
  unitPriceMinor: bigint;
  amountMinor: bigint;
}

export interface DocumentGroup {
  /** null = linhas sem secção. */
  section: string | null;
  lines: DocumentLine[];
  subtotalMinor: bigint;
}

export interface QuoteDocumentModel {
  groups: DocumentGroup[];
  /** Preço antes do desconto (= preço sem imposto + desconto). */
  subtotalMinor: bigint;
  productsMinor: bigint;
  servicesMinor: bigint;
}

/** "12.500" → "12.5"; 3 → "3". */
export function quantityText(q: string | number): string {
  const s = typeof q === "number" ? q.toString() : q.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return "0";
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Preço unitário = valor da linha ÷ quantidade, arredondado ao cêntimo (meio para cima), sem vírgula flutuante. */
export function unitPriceMinor(amountMinor: bigint, quantity: string): bigint {
  const [int = "0", frac = ""] = quantity.split(".");
  const scale = 10n ** BigInt(frac.length);
  const q = BigInt(int + frac);
  if (q === 0n) return 0n;
  return (amountMinor * scale * 2n + q) / (2n * q);
}

export function buildQuoteDocument(input: {
  currency: string;
  priceBeforeTaxMinor: bigint;
  discountMinor: bigint;
  lines: readonly DocumentLineInput[];
}): QuoteDocumentModel {
  const subtotal = input.priceBeforeTaxMinor + input.discountMinor;
  const prices = allocateLinePrices(
    moneyFromMinor(subtotal, input.currency),
    input.lines.map((l) => moneyFromMinor(l.totalCostMinor, input.currency)),
  ).map((p) => p.amountMinor);
  const groups: DocumentGroup[] = [];
  let productsMinor = 0n;
  let servicesMinor = 0n;
  input.lines.forEach((l, i) => {
    const amount = prices[i] ?? 0n;
    const quantity = quantityText(l.quantity);
    const section = l.section?.trim() ? l.section.trim() : null;
    const last = groups[groups.length - 1];
    const group = last && last.section === section ? last : (groups[groups.push({ section, lines: [], subtotalMinor: 0n }) - 1] as DocumentGroup);
    group.lines.push({ id: l.id, description: l.description, nature: l.nature, quantity, unit: l.unit, unitPriceMinor: unitPriceMinor(amount, quantity), amountMinor: amount });
    group.subtotalMinor += amount;
    if (l.nature === "product") productsMinor += amount;
    else servicesMinor += amount;
  });
  return { groups, subtotalMinor: subtotal, productsMinor, servicesMinor };
}
