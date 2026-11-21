import { type Decimal, compareDecimal, decimal, decimalToString, divideRounded, multiplyDecimal, pow10, rescale, subtractDecimal, addDecimal } from "./decimal";
import { type Money, moneyFromMinor } from "./money";
import { type PriceObservation, priceItemKey } from "./price-history";

/**
 * Inventário: o mesmo cálculo que o servidor faz em private.apply_stock_movement, para pré-visualizar
 * um movimento antes de o registar. O valor gravado é sempre o do servidor.
 * Quantidades com até 3 casas decimais; custos em unidades mínimas (bigint).
 */
export type StockMovementKind = "in" | "out" | "loss" | "count";

export interface StockState {
  /** Quantidade em stock (texto decimal, até 3 casas). */
  quantity: string;
  averageCostMinor: bigint;
}

export class StockError extends Error {
  constructor(public readonly code: "quantity_invalid" | "stock_insufficient" | "amount_invalid") {
    super(code);
  }
}

const SCALE = 3;
const q = (v: string): Decimal => rescale(decimal(v), SCALE);
const out = (d: Decimal) => decimalToString(rescale(d, SCALE));

export function applyStockMovement(
  state: StockState,
  movement: { kind: StockMovementKind; quantity: string; unitCostMinor?: bigint | null },
): StockState & { quantityChange: string } {
  const balance = q(state.quantity);
  const amount = q(movement.quantity);
  const zeroQ = q("0");
  if (compareDecimal(amount, zeroQ) < 0 || (movement.kind !== "count" && compareDecimal(amount, zeroQ) === 0)) {
    throw new StockError("quantity_invalid");
  }
  if (movement.kind === "in") {
    if (movement.unitCostMinor === null || movement.unitCostMinor === undefined || movement.unitCostMinor < 0n) {
      throw new StockError("amount_invalid");
    }
    const total = addDecimal(balance, amount);
    // (saldo × médio + quantidade × custo) / (saldo + quantidade), arredondado a meio para cima (como o round do Postgres).
    const value = addDecimal(multiplyDecimal(balance, decimal(state.averageCostMinor)), multiplyDecimal(amount, decimal(movement.unitCostMinor)));
    const numerator = value.coefficient * pow10(total.scale);
    const denominator = total.coefficient * pow10(value.scale);
    return { quantity: out(total), averageCostMinor: divideRounded(numerator, denominator, "half-up"), quantityChange: out(amount) };
  }
  if (movement.kind === "out" || movement.kind === "loss") {
    if (compareDecimal(amount, balance) > 0) throw new StockError("stock_insufficient");
    return { quantity: out(subtractDecimal(balance, amount)), averageCostMinor: state.averageCostMinor, quantityChange: out(subtractDecimal(zeroQ, amount)) };
  }
  return { quantity: out(amount), averageCostMinor: state.averageCostMinor, quantityChange: out(subtractDecimal(amount, balance)) };
}

/** Valor do stock: quantidade × custo médio, arredondado à unidade mínima. */
export function stockValue(quantity: string, averageCostMinor: bigint, currency: string): Money {
  const v = rescale(multiplyDecimal(q(quantity), decimal(averageCostMinor)), 0, "half-up");
  return moneyFromMinor(v.coefficient, currency);
}

/** A quantidade está abaixo do mínimo (mínimo zero = sem alerta). */
export function isBelowMinimum(quantity: string, minimum: string): boolean {
  const min = q(minimum);
  return compareDecimal(min, q("0")) > 0 && compareDecimal(q(quantity), min) < 0;
}

/**
 * Comparação do mesmo artigo entre fornecedores: para cada artigo (nome normalizado + unidade + moeda),
 * o preço mais recente de cada fornecedor, do mais barato para o mais caro, e a diferença para o mais barato.
 * Só artigos com dois ou mais fornecedores. Moedas e unidades diferentes nunca se comparam.
 */
export interface SupplierPriceObservation extends PriceObservation {
  supplierId: string;
  supplierName: string;
}

export interface SupplierOffer {
  supplierId: string;
  supplierName: string;
  priceId: string;
  price: Money;
  observedOn: string;
  /** Diferença para o mais barato (0 no mais barato). */
  aboveCheapest: Money;
}

export interface SupplierComparison {
  key: string;
  itemName: string;
  unit: string | null;
  currency: string;
  offers: SupplierOffer[];
}

export function compareSupplierPrices(observations: readonly SupplierPriceObservation[]): SupplierComparison[] {
  const latest = new Map<string, Map<string, SupplierPriceObservation>>();
  for (const o of observations) {
    const key = priceItemKey(o.itemName, o.unit, o.currency);
    const bySupplier = latest.get(key) ?? new Map<string, SupplierPriceObservation>();
    latest.set(key, bySupplier);
    const current = bySupplier.get(o.supplierId);
    const newer =
      !current || o.observedOn > current.observedOn || (o.observedOn === current.observedOn && o.createdAt > current.createdAt);
    if (newer) bySupplier.set(o.supplierId, o);
  }
  const result: SupplierComparison[] = [];
  for (const [key, bySupplier] of latest) {
    if (bySupplier.size < 2) continue;
    const list = [...bySupplier.values()].sort((a, b) =>
      a.unitPriceMinor === b.unitPriceMinor ? a.supplierName.localeCompare(b.supplierName, "pt") : a.unitPriceMinor < b.unitPriceMinor ? -1 : 1,
    );
    const cheapest = list[0]!.unitPriceMinor;
    const newest = [...list].sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0]!;
    result.push({
      key,
      itemName: newest.itemName.trim().replace(/\s+/g, " "),
      unit: newest.unit,
      currency: newest.currency,
      offers: list.map((o) => ({
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        priceId: o.id,
        price: moneyFromMinor(o.unitPriceMinor, o.currency),
        observedOn: o.observedOn,
        aboveCheapest: moneyFromMinor(o.unitPriceMinor - cheapest, o.currency),
      })),
    });
  }
  return result.sort((a, b) => a.itemName.localeCompare(b.itemName, "pt"));
}
