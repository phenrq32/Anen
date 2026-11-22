import "server-only";
import { decimal, decimalToString, rescale } from "@anen/financial-engine";

/**
 * Cliente da API v2 do InvoiceXpress (programa de faturação certificado pela AT, nº 192).
 * Doc: https://docs.invoicexpress.com/v2. Base https://{conta}.app.invoicexpress.com, chave em ?api_key=.
 * Datas dd/mm/aaaa; carga das guias dd/mm/aaaa HH:mm:ss (hora de Portugal). Sem SDK.
 */
export type InvoiceKind = "invoice" | "invoice_receipt" | "simplified_invoice" | "credit_note";
export type GuideKind = "transport" | "shipping";
export type DocumentKind = InvoiceKind | GuideKind;

const PATH: Record<DocumentKind, string> = {
  invoice: "invoices",
  invoice_receipt: "invoice_receipts",
  simplified_invoice: "simplified_invoices",
  credit_note: "credit_notes",
  transport: "transports",
  shipping: "shippings",
};

export const isGuide = (k: DocumentKind): k is GuideKind => k === "transport" || k === "shipping";

export class InvoicingError extends Error {
  constructor(
    public readonly code: "auth" | "not_found" | "invalid" | "rate_limit" | "unavailable" | "email_disabled",
    message: string,
  ) {
    super(message);
  }
}

export interface IxTax {
  id: number;
  name: string;
  value: string;
  region: string;
  default_tax: number;
}

export interface IxSequence {
  id: number;
  serie: string;
  default_sequence: number | boolean;
}

export interface IxClient {
  name: string;
  code?: string;
  fiscal_id?: string;
  email?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export interface IxItem {
  name: string;
  description?: string;
  unit_price: number;
  quantity: number;
  discount?: number;
  tax?: { name: string };
}

export interface IxAddress {
  detail: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface IxDocumentInput {
  date: string;
  due_date?: string;
  client: IxClient;
  items: IxItem[];
  reference?: string;
  observations?: string;
  tax_exemption?: string;
  sequence_id?: string;
  owner_invoice_id?: number;
  proprietary_uid: string;
  // guias
  loaded_at?: string;
  license_plate?: string;
  address_from?: IxAddress;
  address_to?: IxAddress;
}

export interface IxDocument {
  id: number;
  status: string;
  sequence_number?: string | null;
  atcud?: string | null;
  saft_hash?: string | null;
  permalink?: string | null;
  at_doc_code_id?: string | null;
  before_taxes?: number | string | null;
  taxes?: number | string | null;
  total?: number | string | null;
}

/** Valor do InvoiceXpress (número ou texto "12.5") → unidades mínimas, arredondado a meio para cima. */
export function toMinor(value: number | string | null | undefined, minorUnit = 2): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? value.toFixed(6) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return rescale(decimal(text), minorUnit, "half-up").coefficient;
}

/** Unidades mínimas → número para a API (o InvoiceXpress recebe números decimais). */
export function fromMinor(value: bigint, minorUnit = 2): number {
  // Passa pelo texto decimal exato ("12.34") para não introduzir erros de vírgula flutuante.
  return Number(decimalToString({ coefficient: value, scale: minorUnit }));
}

/** "2026-11-22" → "22/11/2026". */
export function ixDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "AAAA-MM-DDTHH:mm" em hora de Portugal continental → instante UTC (considera a hora de verão). */
export function lisbonLocalToUtc(local: string): Date {
  const [d, t] = local.split("T") as [string, string];
  const [y, mo, da] = d.split("-").map(Number) as [number, number, number];
  const [h, mi] = t.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(guess));
  const lh = Number(parts.find((p) => p.type === "hour")?.value ?? h) % 24;
  const lm = Number(parts.find((p) => p.type === "minute")?.value ?? mi);
  let offsetMin = lh * 60 + lm - (h * 60 + mi);
  if (offsetMin > 720) offsetMin -= 1440;
  if (offsetMin < -720) offsetMin += 1440;
  return new Date(guess - offsetMin * 60_000);
}

/** Instante → "dd/mm/aaaa HH:mm:ss" na hora de Portugal continental. */
export function ixDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}`;
}

export class InvoiceXpress {
  private readonly base: string;

  constructor(
    accountName: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(accountName)) throw new InvoicingError("invalid", "Nome de conta inválido");
    this.base = `https://${accountName}.app.invoicexpress.com`;
  }

  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, attempt = 0): Promise<{ status: number; data: T }> {
    const url = `${this.base}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new InvoicingError("unavailable", "Sem resposta do InvoiceXpress");
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return this.request(method, path, body, attempt + 1);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return { status: res.status, data: data as T };
    const message =
      (data as { errors?: { error?: string }[] } | null)?.errors?.map((e) => e.error).filter(Boolean).join(" · ") ||
      `HTTP ${res.status}`;
    if (res.status === 401) throw new InvoicingError("auth", message);
    if (res.status === 403) throw new InvoicingError("email_disabled", message);
    if (res.status === 404) throw new InvoicingError("not_found", message);
    if (res.status === 429) throw new InvoicingError("rate_limit", message);
    if (res.status >= 500) throw new InvoicingError("unavailable", message);
    throw new InvoicingError("invalid", message);
  }

  async listTaxes(): Promise<IxTax[]> {
    const { data } = await this.request<{ taxes?: IxTax[] }>("GET", "/taxes.json");
    return data?.taxes ?? [];
  }

  async listSequences(): Promise<IxSequence[]> {
    const { data } = await this.request<{ sequences?: IxSequence[] }>("GET", "/sequences.json");
    return data?.sequences ?? [];
  }

  /** Cria o documento em rascunho no InvoiceXpress (ainda sem número nem valor fiscal). */
  async create(kind: DocumentKind, input: IxDocumentInput): Promise<IxDocument> {
    const root = kind;
    const { data } = await this.request<Record<string, IxDocument>>("POST", `/${PATH[kind]}.json`, { [root]: input });
    const doc = data?.[root] ?? data?.invoice ?? Object.values(data ?? {})[0];
    if (!doc?.id) throw new InvoicingError("invalid", "Resposta sem documento");
    return doc;
  }

  /** Finaliza (fatura-recibo: fica logo "settled"), anula (com motivo) ou marca paga/por pagar. */
  async changeState(kind: DocumentKind, id: number, state: "finalized" | "canceled" | "settled" | "unsettled" | "deleted", message?: string): Promise<IxDocument | null> {
    const root = isGuide(kind) ? kind : "invoice";
    const { data } = await this.request<Record<string, IxDocument>>("PUT", `/${PATH[kind]}/${id}/change-state.json`, {
      [root]: { state, ...(message ? { message } : {}) },
    });
    return data?.[root] ?? (data ? (Object.values(data)[0] ?? null) : null);
  }

  async get(kind: DocumentKind, id: number): Promise<IxDocument | null> {
    const { data } = await this.request<Record<string, IxDocument>>("GET", `/${PATH[kind]}/${id}.json`);
    return data?.[kind] ?? data?.invoice ?? (data ? (Object.values(data)[0] ?? null) : null);
  }

  /** Link do PDF (o InvoiceXpress pode demorar a gerá-lo: responde 202 e tenta-se de novo). */
  async pdfUrl(id: number, tries = 6): Promise<string> {
    for (let i = 0; i < tries; i++) {
      const { status, data } = await this.request<{ output?: { pdfUrl?: string } }>("GET", `/api/pdf/${id}.json`);
      if (status === 200 && data?.output?.pdfUrl) return data.output.pdfUrl;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new InvoicingError("unavailable", "O PDF ainda está a ser gerado");
  }

  async sendEmail(kind: DocumentKind, id: number, email: string, subject: string, body: string): Promise<void> {
    await this.request("PUT", `/${PATH[kind]}/${id}/email-document.json`, {
      message: { client: { email, save: "0" }, subject, body, logo: "1" },
    });
  }
}
