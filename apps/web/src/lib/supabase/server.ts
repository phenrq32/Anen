import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@anen/types/database";
import { getPublicEnv } from "@/lib/env";

export class SupabaseNotConfiguredError extends Error {
  override name = "SupabaseNotConfiguredError";
}

/** Cliente Supabase com a sessão do utilizador (cookies). Usa apenas a chave publicável; RLS protege os dados. */
export async function createClient() {
  const env = getPublicEnv();
  if (!env) throw new SupabaseNotConfiguredError("Supabase não configurado");
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Chamado a partir de um Server Component: o proxy trata da renovação da sessão.
        }
      },
    },
  });
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;
