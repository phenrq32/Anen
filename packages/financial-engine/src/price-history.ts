import type { Decimal } from "./decimal";
import { marginPercent } from "./formulas";
import { type Money, moneyFromMinor, subtract } from "./money";

/**
 * Histórico de preços registados pelo utilizador (por fornecedor). Determinístico, sem ponto flutuante.
 * Os registos agrupam-se por artigo: nome normalizado (sem maiúsculas nem espaços repetidos),
 * unidade e moeda. Moedas diferentes nunca se comparam.
 */
export interface PriceObservation {
  id: string;
  itemName: string;
  unit: string | null;
  unitPriceMinor: bigint;
  currency: string;
  /** Data ISO (AAAA-MM-DD). */
  observedOn: string;
  /** Desempate para registos do mesmo dia (ISO timestamp). */
  createdAt: string;
}

export interface PriceSeries {
  key: string;
  itemName: string;
  unit: string | null;
  currency: string;
  /** Do mais antigo para o mais recente. */
  points: PriceObservation[];
  latest: Money;
  latestOn: string;
  previous: Money | null;
  /** latest − previous (positivo = subida). */
  change: Money | null;
  /** Variação em % do preço anterior; null sem anterior ou com anterior a zero. */
  changePercent: Decimal | null;
  min: Money;
  max: Money;
}

export function priceItemKey(itemName: string, unit: string | null, currency: string): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt");
  return `${norm(itemName)}|${norm(unit ?? "")}|${currency}`;
}

const chronological = (a: PriceObservation, b: PriceObservation) =>
  a.observedOn === b.observedOn ? a.createdAt.localeCompare(b.createdAt) : a.observedOn.localeCompare(b.observedOn);

/** Séries por artigo, ordenadas pelo registo mais recente primeiro. */
export function summarizePriceHistory(observations: readonly PriceObservation[]): PriceSeries[] {
  const groups = new Map<string, PriceObservation[]>();
  for (const o of observations) {
    const key = priceItemKey(o.itemName, o.unit, o.currency);
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }
  const series: PriceSeries[] = [];
  for (const [key, list] of groups) {
    const points = [...list].sort(chronological);
    const last = points[points.length - 1]!;
    const before = points.length > 1 ? points[points.length - 2]! : null;
    const money = (v: bigint) => moneyFromMinor(v, last.currency);
    const latest = money(last.unitPriceMinor);
    const previous = before ? money(before.unitPriceMinor) : null;
    const change = previous ? subtract(latest, previous) : null;
    let min = points[0]!.unitPriceMinor;
    let max = min;
    for (const p of points) {
      if (p.unitPriceMinor < min) min = p.unitPriceMinor;
      if (p.unitPriceMinor > max) max = p.unitPriceMinor;
    }
    series.push({
      key,
      // Nome e unidade como escritos no registo mais recente.
      itemName: last.itemName.trim().replace(/\s+/g, " "),
      unit: last.unit,
      currency: last.currency,
      points,
      latest,
      latestOn: last.observedOn,
      previous,
      change,
      changePercent: change && previous ? marginPercent(change, previous, 1) : null,
      min: money(min),
      max: money(max),
    });
  }
  return series.sort((a, b) => chronological(b.points[b.points.length - 1]!, a.points[a.points.length - 1]!));
}
