"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/errors";
import { formString, type FormState } from "@/lib/form";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { guardWorkspace } from "@/lib/workspace-guard";

import { PLAN_LIMIT_KEYS } from "@/lib/plan-limits";
const schema = z.object({
  plan: z.enum(["free", "pro", "max"]),
  key: z.enum(PLAN_LIMIT_KEYS),
  // vazio = sem limite
  value: z.string().trim().regex(/^(\d{1,7})?$/),
  source: z.string().trim().min(1).max(300),
});

/** Fase 9 (§11): administradores definem um limite (nova versão, em vigor a partir de hoje). A base valida quem pode. */
export async function setPlanLimitAction(_: FormState, formData: FormData): Promise<FormState> {
  await guardWorkspace(formData);
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const parsed = schema.safeParse({
    plan: formString(formData, "plan"),
    key: formString(formData, "key"),
    value: formString(formData, "value"),
    source: formString(formData, "source"),
  });
  if (!parsed.success) return { status: "error", message: m.errors.generic };
  const v = parsed.data;
  const { error } = await session.supabase.rpc("admin_set_plan_limit", {
    p_plan: v.plan,
    p_key: v.key,
    p_value: v.value === "" ? null : Number(v.value),
    p_source: v.source,
  });
  if (error) return { status: "error", message: errorMessage(m, error) };
  revalidatePath("/planos", "layout");
  return { status: "success", message: m.billing.limits.saved };
}
