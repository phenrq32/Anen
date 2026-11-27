import "server-only";
import type { Quote } from "@anen/types";
import { buildQuoteDocument, type QuoteDocumentModel } from "./quote-document";
import type { getSession } from "./session";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export interface QuoteDocumentData {
  quote: Quote;
  issuer: { name: string; taxId: string | null; email: string };
  timezone: string;
  minorUnit: number;
  model: QuoteDocumentModel;
}

/** Carrega o que o documento do cliente precisa (página e PDF), com as permissões de quem tem sessão (RLS). */
export async function loadQuoteDocument(session: Session, id: string): Promise<QuoteDocumentData | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data: quote } = await session.supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (!quote) return null;
  const [{ data: items }, { data: currency }, orgRes] = await Promise.all([
    session.supabase.from("quote_items").select("*").eq("quote_id", id).order("position"),
    session.supabase.from("currencies").select("minor_unit").eq("code", quote.currency_code).maybeSingle(),
    quote.organization_id ? session.supabase.from("organizations").select("*").eq("id", quote.organization_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const org = orgRes.data;
  return {
    quote,
    issuer: {
      name: org ? (org.legal_name ?? org.name) : (session.profile.full_name ?? ""),
      taxId: org?.tax_id ?? null,
      email: session.user.email ?? "",
    },
    timezone: org?.timezone ?? session.preferences.timezone,
    minorUnit: currency?.minor_unit ?? 2,
    model: buildQuoteDocument({
      currency: quote.currency_code,
      priceBeforeTaxMinor: BigInt(quote.price_before_tax_minor),
      discountMinor: BigInt(quote.discount_minor),
      lines: (items ?? []).map((i) => ({
        id: i.id,
        section: i.section,
        description: i.description,
        nature: i.nature,
        quantity: i.quantity,
        unit: i.unit,
        totalCostMinor: BigInt(i.total_cost_minor),
      })),
    }),
  };
}
