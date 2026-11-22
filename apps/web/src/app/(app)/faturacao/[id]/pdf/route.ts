import { NextResponse, type NextRequest } from "next/server";
import { loadInvoicing, clientFor } from "@/lib/invoicing/service";
import { getSession } from "@/lib/session";

/** PDF oficial: pedido ao InvoiceXpress na hora (o link dele é temporário) e redirecionado. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 });
  const { fin, connection } = await loadInvoicing(session);
  if (!fin.canRead || !connection) return new NextResponse(null, { status: 403 });
  const { data: doc } = await session.supabase.from("fiscal_documents").select("provider_id, status, connection_id").eq("id", id).maybeSingle();
  if (!doc || doc.status === "draft" || doc.connection_id !== connection.id) return new NextResponse(null, { status: 404 });
  try {
    const url = await clientFor(connection).pdfUrl(doc.provider_id);
    if (!/^https:\/\//.test(url)) return new NextResponse(null, { status: 502 });
    return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new NextResponse("O PDF ainda não está disponível. Tente de novo dentro de instantes.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
