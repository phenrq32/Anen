import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { activeWorkspace, workspaceKey } from "@/lib/workspace";

/**
 * Workspace ativo da sessão ("personal" ou "org:<id>"), para uma aba saber se outra aba ou outro aparelho
 * mudou de contexto e se deve atualizar. Não devolve dados do workspace, só a chave da própria pessoa.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ key: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ key: workspaceKey(activeWorkspace(session)) }, { headers: { "Cache-Control": "no-store" } });
}
