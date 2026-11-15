export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
  siteUrl: string;
  googleAuthEnabled: boolean;
}

/**
 * Lê a configuração pública. Devolve null quando o Supabase não está configurado,
 * para a interface mostrar o estado real em vez de falhar ou simular dados.
 */
export function getPublicEnv(): PublicEnv | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!supabaseUrl || !supabaseKey) return null;
  return {
    supabaseUrl,
    supabaseKey,
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/$/, ""),
    googleAuthEnabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true",
  };
}
