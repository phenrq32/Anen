"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { format } from "@anen/i18n";
import { MAX_STATEMENT_ROWS, parseBankDate } from "@anen/validation";
import { buildCategoryMemory, descriptionKey, suggestCategory } from "@/lib/category-memory";
import { errorMessage } from "@/lib/errors";
import { financeScope, scopeFields } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

/** Linha vinda do navegador (já lida do ficheiro); tudo é validado outra vez aqui. */
const rowSchema = z.object({
  occurredOn: z.string().refine((v) => parseBankDate(v) === v),
  description: z.string().trim().min(1).max(200),
  amountMinor: z.string().regex(/^-?[1-9][0-9]{0,15}$/),
  ref: z.string().min(1).max(200),
  categoryId: z.union([z.uuid(), z.literal("")]).optional(),
});
const payloadSchema = z.object({ accountId: z.uuid(), rows: z.array(rowSchema).min(1).max(MAX_STATEMENT_ROWS) });
export type ImportRowInput = z.infer<typeof rowSchema>;

export interface PreviewResult {
  ok: boolean;
  message?: string;
  /** Por referência: já existe na conta (mesma referência, ou mesma data, valor e descrição). */
  duplicates?: string[];
  /** Por referência: categoria lembrada. */
  suggestions?: Record<string, string>;
}

const MAX_SAFE = 9007199254740991n;

async function context() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  return { m, session, scope };
}

/** Marca duplicados e sugere categorias, sem gravar nada. */
export async function previewImportAction(payload: { accountId: string; rows: ImportRowInput[] }): Promise<PreviewResult> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { ok: false, message: m.errors.forbidden };
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: m.import.invalidFile };
  const { accountId, rows } = parsed.data;
  const { data: account } = await session.supabase.from("financial_accounts").select("id").eq("id", accountId).eq(scope.column, scope.value).maybeSingle();
  if (!account) return { ok: false, message: m.errors.account_invalid };

  const dates = rows.map((r) => r.occurredOn).sort();
  const [existingRes, memoryRes] = await Promise.all([
    session.supabase
      .from("transactions")
      .select("occurred_on, amount_minor, kind, description, import_ref")
      .eq("account_id", accountId)
      .gte("occurred_on", dates[0]!)
      .lte("occurred_on", dates[dates.length - 1]!)
      .limit(5000),
    session.supabase
      .from("transactions")
      .select("description, kind, category_id")
      .eq(scope.column, scope.value)
      .not("category_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const existing = existingRes.data ?? [];
  const refs = new Set(existing.map((t) => t.import_ref).filter(Boolean));
  // Mesma data, valor com sinal e descrição: conta quantas vezes já existe (dois cafés no mesmo dia são dois).
  const same = new Map<string, number>();
  for (const t of existing) {
    const k = `${t.occurred_on}|${t.kind === "expense" ? -BigInt(t.amount_minor) : BigInt(t.amount_minor)}|${descriptionKey(t.description)}`;
    same.set(k, (same.get(k) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const r of rows) {
    const k = `${r.occurredOn}|${BigInt(r.amountMinor)}|${descriptionKey(r.description)}`;
    if (refs.has(r.ref)) duplicates.push(r.ref);
    else if ((same.get(k) ?? 0) > 0) {
      duplicates.push(r.ref);
      same.set(k, same.get(k)! - 1);
    }
  }
  const memory = buildCategoryMemory(memoryRes.data ?? []);
  const suggestions: Record<string, string> = {};
  for (const r of rows) {
    const id = suggestCategory(memory, BigInt(r.amountMinor) < 0n ? "expense" : "income", r.description);
    if (id) suggestions[r.ref] = id;
  }
  return { ok: true, duplicates, suggestions };
}

/** Grava as linhas escolhidas. Linhas já importadas (mesma referência na conta) são ignoradas pela base de dados. */
export async function importStatementAction(payload: { accountId: string; rows: ImportRowInput[] }): Promise<PreviewResult & { imported?: number }> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { ok: false, message: m.errors.forbidden };
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: m.import.invalidFile };
  const { accountId, rows } = parsed.data;
  const { data: account } = await session.supabase
    .from("financial_accounts")
    .select("id, currency_code")
    .eq("id", accountId)
    .eq(scope.column, scope.value)
    .is("archived_at", null)
    .maybeSingle();
  if (!account) return { ok: false, message: m.errors.account_invalid };
  const { data: cats } = await session.supabase.from("transaction_categories").select("id, kind");
  const catKind = new Map((cats ?? []).map((c) => [c.id, c.kind]));

  const records = [];
  for (const r of rows) {
    const signed = BigInt(r.amountMinor);
    const amount = signed < 0n ? -signed : signed;
    if (amount === 0n || amount > MAX_SAFE) return { ok: false, message: m.errors.amount_invalid };
    const kind = signed < 0n ? ("expense" as const) : ("income" as const);
    const category = r.categoryId && catKind.get(r.categoryId) === kind ? r.categoryId : null;
    records.push({
      ...scopeFields(scope),
      account_id: accountId,
      kind,
      amount_minor: Number(amount),
      currency_code: account.currency_code,
      occurred_on: r.occurredOn,
      description: r.description,
      category_id: category,
      counterparty: null,
      notes: null,
      import_ref: r.ref,
    });
  }
  let imported = 0;
  for (let i = 0; i < records.length; i += 500) {
    const { data, error } = await session.supabase
      .from("transactions")
      .upsert(records.slice(i, i + 500), { onConflict: "account_id,import_ref", ignoreDuplicates: true })
      .select("id");
    if (error) return { ok: false, message: errorMessage(m, error), imported };
    imported += data?.length ?? 0;
  }
  revalidatePath("/financas", "layout");
  revalidatePath("/painel");
  return { ok: true, imported, message: format(m.import.done, { count: imported, skipped: records.length - imported }) };
}
