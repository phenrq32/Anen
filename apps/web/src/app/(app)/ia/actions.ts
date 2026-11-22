"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAgent } from "@/lib/ai/agent";
import { AiUnavailableError, geminiConfig } from "@/lib/ai/gemini";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

const UUID = /^[0-9a-f-]{36}$/;

export async function acceptAiConsentAction(): Promise<void> {
  const session = await requireOnboardedSession();
  await session.supabase.from("ai_consents").insert({ user_id: session.user.id });
  revalidatePath("/ia");
}

export async function askAiAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const config = geminiConfig();
  if (!config) return { status: "error", message: m.errors.ai_not_configured };
  const question = formString(formData, "question").trim().slice(0, 2000);
  if (!question) return { status: "error", fieldErrors: { question: m.errors.question_required } };
  const orgId = session.active?.organization.id ?? null;

  // Conversa existente (RLS: só as da própria pessoa) ou nova.
  let conversationId = formString(formData, "conversationId");
  let created = false;
  if (conversationId) {
    if (!UUID.test(conversationId)) return { status: "error", message: m.errors.forbidden };
    const { data } = await session.supabase.from("ai_conversations").select("id, organization_id").eq("id", conversationId).maybeSingle();
    if (!data || data.organization_id !== orgId) return { status: "error", message: m.errors.forbidden };
  }

  // Reserva a pergunta no limite diário ANTES de chamar o modelo (o servidor decide, não a interface).
  const begin = await session.supabase.rpc("ai_begin_request", { p_org: orgId });
  const usage = begin.data?.[0];
  if (begin.error || !usage) return { status: "error", message: errorMessage(m, begin.error) };

  if (!conversationId) {
    const title = question.replace(/\s+/g, " ").slice(0, 80);
    const { data, error } = await session.supabase
      .from("ai_conversations")
      .insert({ user_id: session.user.id, organization_id: orgId, title })
      .select("id");
    if (error || !data?.[0]) {
      await session.supabase.rpc("ai_finish_request", { p_usage_id: usage.usage_id, p_ok: false, p_model: "", p_input: 0, p_output: 0 });
      return { status: "error", message: errorMessage(m, error) };
    }
    conversationId = data[0].id;
    created = true;
  }

  const { data: history } = await session.supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  await session.supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "user", content: question });

  try {
    const answer = await runAgent({ session, m, locale }, question, (history ?? []).reverse(), config);
    await session.supabase.from("ai_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: answer.text.slice(0, 20000),
      sources: answer.sources.slice(0, 30),
      tools: [...new Set(answer.tools)].slice(0, 30),
      model: answer.model,
    });
    await session.supabase.rpc("ai_finish_request", {
      p_usage_id: usage.usage_id,
      p_ok: true,
      p_model: answer.model,
      p_input: answer.inputTokens,
      p_output: answer.outputTokens,
    });
    // Sobe a conversa na lista (updated_at) sem mudar o título.
    await session.supabase.from("ai_conversations").update({ title: (await currentTitle(session.supabase, conversationId)) ?? question.slice(0, 80) }).eq("id", conversationId);
  } catch (e) {
    await session.supabase.rpc("ai_finish_request", { p_usage_id: usage.usage_id, p_ok: false, p_model: "", p_input: 0, p_output: 0 });
    revalidatePath("/ia");
    if (created) redirect(`/ia?c=${conversationId}&erro=1`);
    return { status: "error", message: e instanceof AiUnavailableError ? m.errors.ai_unavailable : m.errors.generic };
  }
  revalidatePath("/ia");
  if (created) redirect(`/ia?c=${conversationId}`);
  return { status: "success" };
}

/** Mantém o título (o update serve para subir a conversa na lista pelo updated_at). */
async function currentTitle(
  supabase: Awaited<ReturnType<typeof requireOnboardedSession>>["supabase"],
  id: string,
): Promise<string | null> {
  const { data } = await supabase.from("ai_conversations").select("title").eq("id", id).maybeSingle();
  return data?.title ?? null;
}

export async function deleteConversationAction(_: FormState, formData: FormData): Promise<FormState> {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const { data, error } = await session.supabase.from("ai_conversations").delete().eq("id", formString(formData, "id")).select("id");
  if (error) return { status: "error", message: errorMessage(m, error) };
  if (!data?.length) return { status: "error", message: m.errors.forbidden };
  revalidatePath("/ia");
  redirect("/ia");
}
