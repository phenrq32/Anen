import { format, formatDate, formatMoney, type Messages } from "@anen/i18n";
import type { AppNotification, Locale } from "@anen/types";

/** Lê um campo de texto/número de data (jsonb) sem confiar no tipo. */
const str = (d: Record<string, unknown>, k: string): string => {
  const v = d[k];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
};
const int = (d: Record<string, unknown>, k: string): bigint | null => {
  const v = d[k];
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
};

/** Caminho interno seguro para redirecionar (a base de dados já o restringe; aqui confirma-se). */
export function safeNotificationLink(link: string | null): string {
  return link && /^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/.test(link) ? link : "/notificacoes";
}

export function notificationText(
  m: Messages,
  locale: Locale,
  n: AppNotification,
  minorUnits: Map<string, number>,
): { title: string; body: string } {
  const t = m.notifications;
  const d = n.data;
  const day = (v: string) => (v ? formatDate(v, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }) : "");
  const money = (k: string) => {
    const currency = str(d, "currency");
    const v = int(d, k);
    return v === null || !currency ? "" : formatMoney(v, currency, minorUnits.get(currency) ?? 2, locale);
  };
  const number = (k: string) => {
    const v = Number(str(d, k));
    return Number.isFinite(v) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(v) : "";
  };
  switch (n.kind) {
    case "payment_overdue":
    case "payment_due_soon": {
      const income = str(d, "direction") === "income";
      const overdue = n.kind === "payment_overdue";
      const title = overdue ? (income ? t.titles.overdueIncome : t.titles.overdueExpense) : income ? t.titles.dueSoonIncome : t.titles.dueSoonExpense;
      return {
        title: format(title, { description: str(d, "description") }),
        body: format(overdue ? t.bodies.overdue : t.bodies.dueSoon, { amount: money("remaining_minor"), date: day(str(d, "due_on")) }),
      };
    }
    case "stock_below_minimum":
      return {
        title: format(t.titles.stock, { name: str(d, "name") }),
        body: format(t.bodies.stock, { quantity: number("quantity"), minimum: number("minimum"), unit: str(d, "unit") }),
      };
    case "purchase_late":
      return {
        title: format(t.titles.purchaseLate, { supplier: str(d, "supplier") || m.purchases.supplierDeleted }),
        body: format(t.bodies.purchaseLate, { date: day(str(d, "expected_on")), amount: money("total_minor") }),
      };
    case "market_alert": {
      const period = str(d, "period");
      return {
        title: format(t.titles.market, { series: str(d, "series") }),
        body: format(t.bodies.market, {
          change: number("change_month"),
          period: period ? formatDate(period, locale, "UTC", { month: "long", year: "numeric" }) : "",
          threshold: number("threshold"),
        }),
      };
    }
  }
}
