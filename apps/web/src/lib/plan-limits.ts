export const PLAN_LIMIT_KEYS = ["organizations", "members", "projects", "quotes_per_month", "market_watches"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export interface PlanLimitRow {
  plan_key: string;
  limit_key: string;
  value: number | null;
  valid_from: string;
  source: string;
}

/** Limite em vigor por plano e chave: a versão mais recente já começada (null = sem limite). */
export function currentPlanLimits(rows: readonly PlanLimitRow[], today: string): Map<string, Map<string, PlanLimitRow>> {
  const out = new Map<string, Map<string, PlanLimitRow>>();
  for (const r of rows) {
    if (r.valid_from > today) continue;
    const byKey = out.get(r.plan_key) ?? new Map<string, PlanLimitRow>();
    const prev = byKey.get(r.limit_key);
    if (!prev || prev.valid_from < r.valid_from) byKey.set(r.limit_key, r);
    out.set(r.plan_key, byKey);
  }
  return out;
}
