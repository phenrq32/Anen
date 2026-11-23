import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

// /api/push/dispatch: rotina do servidor, protegida pelo próprio segredo (não tem sessão de utilizador).
const PUBLIC_PREFIXES = ["/entrar", "/criar-conta", "/recuperar-acesso", "/auth", "/convite", "/api/push/dispatch", "/api/billing/infinitepay"];
const AUTH_ONLY_PAGES = ["/entrar", "/criar-conta", "/recuperar-acesso"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Renova a sessão Supabase em cada pedido e protege as rotas privadas.
 * A autorização dos dados é sempre feita na base de dados (RLS); isto é só navegação.
 */
export async function proxy(request: NextRequest) {
  const env = getPublicEnv();
  if (!env) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname) && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && AUTH_ONLY_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/painel";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Ficheiros da app instalável (manifesto, service worker, ícones, página sem rede) não passam pela sessão.
  matcher: [
    "/((?!_next/static|_next/image|icon.svg|logo.svg|favicon.ico|robots.txt|manifest.webmanifest|sw.js|offline.html|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png).*)",
  ],
};
