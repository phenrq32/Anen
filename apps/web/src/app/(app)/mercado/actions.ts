"use server";

import { revalidatePath } from "next/cache";
import { format } from "@anen/i18n";
import { parsePercentInput } from "@anen/validation";
import { businessScope, businessScopeFields } from "@/lib/business";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context() {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  return { m, session, scope: businessScope(session) };
}

/** Acompanhar uma série (ou mudar o limiar): alerta quando |variação mensal| ≥ limiar. */
export async function saveWatchAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const seriesId = formString(formData, "seriesId");
  const watchId = formString(formData, "watchId");
  const threshold = parsePercentInput(formString(formData, "threshold"));
  if (!UUID.test(seriesId) || (watchId && !UUID.test(watchId))) return { status: "error", message: m.errors.generic };
  if (threshold === null || Number(threshold) <= 0) return { status: "error", fieldErrors: { threshold: m.errors.percent_invalid } };
  const result = watchId
    ? await session.supabase.from("market_watches").update({ threshold_percent: Number(threshold) }).eq("id", watchId).eq(scope.column, scope.value).select("id")
    : await session.supabase.from("market_watches").insert({ ...businessScopeFields(scope), series_id: seriesId, threshold_percent: Number(threshold) }).select("id");
  if (result.error) return { status: "error", message: errorMessage(m, result.error) };
  if (!result.data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/mercado");
  return { status: "success", message: m.market.watch.saved };
}

export async function removeWatchAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canWrite) return { status: "error", message: m.errors.forbidden };
  const { data, error } = await session.supabase.from("market_watches").delete().eq("id", formString(formData, "watchId")).eq(scope.column, scope.value).select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/mercado");
  return { status: "success" };
}

export async function markAlertsReadAction(_: FormState, _formData: FormData): Promise<FormState> {
  const { m, session, scope } = await context();
  if (!scope.canRead) return { status: "error", message: m.errors.forbidden };
  const { error } = await session.supabase.from("market_alerts").update({ read_at: new Date().toISOString() }).eq(scope.column, scope.value).is("read_at", null);
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/mercado");
  revalidatePath("/painel");
  return { status: "success" };
}

/** Só administradores da plataforma (a função verifica-o na base de dados). */
export async function runMarketAgentAction(_: FormState, _formData: FormData): Promise<FormState> {
  const { m, session } = await context();
  const { data, error } = await session.supabase.rpc("run_market_agent_now", {});
  if (error || !data) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/mercado");
  return { status: data.failed > 0 ? "error" : "success", message: format(m.market.agent.ran, { observations: data.observations, failed: data.failed, alerts: data.alerts }) };
}
