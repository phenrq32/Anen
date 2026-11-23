/**
 * Período de um movimento agregado ("recebi X esta semana"): dia, semana (segunda a domingo) ou mês.
 * Tudo em datas AAAA-MM-DD (sem horas nem fuso).
 */
export const MOVEMENT_PERIODS = ["day", "week", "month"] as const;
export type MovementPeriod = (typeof MOVEMENT_PERIODS)[number];

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function periodRange(period: MovementPeriod, reference: string): { start: string; end: string } {
  const d = parse(reference);
  if (period === "day") return { start: reference, end: reference };
  if (period === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - dow);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start: toIso(start), end: toIso(end) };
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: toIso(start), end: toIso(end) };
}

/**
 * Datas a gravar: o período que contém a data de referência e a data do movimento = fim do período,
 * ou hoje se o período ainda não acabou (a semana corrente fica com a data de hoje).
 */
export function periodDates(period: MovementPeriod, reference: string, today: string): { occurredOn: string; start: string; end: string } {
  const { start, end } = periodRange(period, reference);
  const occurredOn = end > today && today >= start ? today : end;
  return { occurredOn, start, end };
}

/** Que tipo de período é um intervalo guardado (para mostrar e para editar). */
export function periodKind(start: string, end: string): MovementPeriod {
  if (start === end) return "day";
  const range = periodRange("week", start);
  if (range.start === start && range.end === end) return "week";
  return "month";
}
