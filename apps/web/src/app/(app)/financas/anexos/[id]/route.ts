import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Abre um anexo: confirma o acesso pelo RLS (o registo só é visível a quem pode ler as finanças
 * do âmbito) e redireciona para um URL assinado de curta duração.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = new URL("/financas/movimentos?anexo=indisponivel", request.url);
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.redirect(back);
  const supabase = await createClient();
  const { data: row } = await supabase.from("transaction_attachments").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.redirect(back);
  const { data } = await supabase.storage.from("attachments").createSignedUrl(row.storage_path, 60);
  if (!data?.signedUrl) return NextResponse.redirect(back);
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
