import { NextResponse, type NextRequest } from "next/server";
import { decimalToString } from "@anen/financial-engine";
import { monthParam } from "@anen/validation";
import { categoryLabel, financeScope, loadFinanceBasics, monthBounds, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { csvCell } from "@/lib/csv";

const UUID = /^[0-9a-f-]{36}$/;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const scope = financeScope(session);
  if (!scope.canRead) return new NextResponse(null, { status: 403 });
  const { m } = await getI18n();
  const params = request.nextUrl.searchParams;
  const month = monthParam.safeParse(params.get("mes") ?? undefined).success && params.get("mes") ? params.get("mes")! : todayIn(scope.timezone).slice(0, 7);
  const { from, to } = monthBounds(month);

  let query = session.supabase
    .from("transactions")
    .select("*")
    .eq(scope.column, scope.value)
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .order("occurred_on");
  const account = params.get("conta");
  const category = params.get("categoria");
  const kind = params.get("tipo");
  if (account && UUID.test(account)) query = query.eq("account_id", account);
  if (category && UUID.test(category)) query = query.eq("category_id", category);
  if (kind === "income" || kind === "expense") query = query.eq("kind", kind);
  const [{ data, error }, basics] = await Promise.all([query, loadFinanceBasics(session.supabase, scope)]);
  if (error) return new NextResponse(null, { status: 500 });

  const accounts = new Map(basics.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(basics.categories.map((c) => [c.id, c]));
  const header = [m.finance.tx.date, m.finance.tx.kind, m.finance.tx.description, m.finance.tx.category, m.finance.tx.account, m.finance.tx.counterparty, m.finance.tx.amount, m.finance.account.currency, m.finance.tx.notes];
  const lines = (data ?? []).map((t) => {
    const unit = basics.minorUnits.get(t.currency_code) ?? 2;
    const signed = BigInt(t.amount_minor) * (t.kind === "expense" ? -1n : 1n);
    return [
      t.occurred_on,
      t.kind === "income" ? m.finance.tx.income : m.finance.tx.expense,
      t.description,
      categoryLabel(m, t.category_id ? categories.get(t.category_id) : undefined),
      accounts.get(t.account_id) ?? "",
      t.counterparty ?? "",
      decimalToString({ coefficient: signed, scale: unit }),
      t.currency_code,
      t.notes ?? "",
    ]
      .map(csvCell)
      .join(";");
  });
  // BOM para o Excel reconhecer UTF-8; ";" é o separador habitual em pt-PT/pt-BR.
  const body = "﻿" + [header.map(csvCell).join(";"), ...lines].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="anen-movimentos-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
