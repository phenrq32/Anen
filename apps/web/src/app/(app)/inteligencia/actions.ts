"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rollingPeriods } from "@anen/financial-engine";
import { format } from "@anen/i18n";
import { runAgent } from "@/lib/ai/agent";
import { AiUnavailableError, geminiConfig } from "@/lib/ai/gemini";
import { errorMessage } from "@/lib/errors";
import { financeScope, todayIn } from "@/lib/finance";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { DIGEST_DAYS, parseDigestKind } from "@/lib/intelligence";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

/**
 * Gera o resumo da ANEN AI para o período (7 ou 30 dias até hoje). Gasta 1 pergunta do limite
 * diário (reservada no servidor antes de chamar o modelo) e guarda o resultado em ai_digests.
 */
export async function generateDigestAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const config = geminiConfig();
  if (!config) return { status: "error", message: m.errors.ai_not_configured };
  const kind = parseDigestKind(formString(formData, "kind"));
  const orgId = session.active?.organization.id ?? null;
  const today = todayIn(financeScope(session).timezone);
  const { current, previous } = rollingPeriods(today, DIGEST_DAYS[kind]);

  const begin = await session.supabase.rpc("ai_begin_request", { p_org: orgId });
  const usage = begin.data?.[0];
  if (begin.error || !usage) return { status: "error", message: errorMessage(m, begin.error) };
  const finish = (ok: boolean, model = "", input = 0, output = 0) =>
    session.supabase.rpc("ai_finish_request", { p_usage_id: usage.usage_id, p_ok: ok, p_model: model, p_input: input, p_output: output });

  try {
    const question = format(m.intelligence.digest.prompt, { from: current.from, to: current.to, pfrom: previous.from, pto: previous.to });
    const answer = await runAgent({ session, m, locale }, question, [], config);
    // Substitui o resumo do mesmo dia (se houver) pelo novo.
    let del = session.supabase.from("ai_digests").delete().eq("user_id", session.user.id).eq("period_kind", kind).eq("period_to", current.to);
    del = orgId ? del.eq("organization_id", orgId) : del.is("organization_id", null);
    await del;
    const { error } = await session.supabase.from("ai_digests").insert({
      user_id: session.user.id,
      organization_id: orgId,
      period_kind: kind,
      period_from: current.from,
      period_to: current.to,
      content: answer.text.slice(0, 20000),
      sources: answer.sources.slice(0, 30),
      tools: [...new Set(answer.tools)].slice(0, 30),
      model: answer.model,
    });
    if (error) {
      await finish(false);
      return { status: "error", message: errorMessage(m, error) };
    }
    await finish(true, answer.model, answer.inputTokens, answer.outputTokens);
  } catch (e) {
    await finish(false);
    return { status: "error", message: e instanceof AiUnavailableError ? m.errors.ai_unavailable : m.errors.generic };
  }
  revalidatePath("/inteligencia");
  redirect(`/inteligencia?periodo=${kind}`);
}
