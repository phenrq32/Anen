import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.INVOICING_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const ix = await import("./invoicexpress");
const crypto = await import("./crypto");

type Call = { method: string; url: string; body: unknown };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("cliente InvoiceXpress", () => {
  it("cria o documento no endpoint e com a raiz certos, com a chave na query", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { invoice: { id: 55, status: "draft", total: 123 } } }]);
    const client = new ix.InvoiceXpress("minhaempresa", "chave-123", fn);
    const doc = await client.create("invoice", {
      date: "22/11/2026",
      client: { name: "Café Azul", fiscal_id: "123456789", country: "Portugal" },
      items: [{ name: "Serviço", unit_price: 100, quantity: 1, tax: { name: "IVA23" } }],
      proprietary_uid: "uid-1",
    });
    expect(doc.id).toBe(55);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://minhaempresa.app.invoicexpress.com/invoices.json?api_key=chave-123");
    expect(calls[0]!.body).toMatchObject({ invoice: { client: { name: "Café Azul" }, proprietary_uid: "uid-1" } });
  });

  it("guias usam o próprio tipo na raiz; anular manda o motivo", async () => {
    const { fn, calls } = fakeFetch([
      { status: 201, body: { transport: { id: 9, status: "draft" } } },
      { status: 200, body: { transport: { id: 9, status: "final", sequence_number: "1/GT", atcud: "ABCD-1", at_doc_code_id: "123456" } } },
      { status: 200, body: { invoice: { id: 55, status: "canceled" } } },
    ]);
    const client = new ix.InvoiceXpress("conta", "k", fn);
    await client.create("transport", {
      date: "22/11/2026",
      client: { name: "X" },
      items: [{ name: "Caixa", unit_price: 1, quantity: 2 }],
      proprietary_uid: "u",
      loaded_at: "23/11/2026 09:00:00",
      address_from: { detail: "Rua A", city: "Lisboa", postal_code: "1000-001", country: "Portugal" },
      address_to: { detail: "Rua B", city: "Porto", postal_code: "4000-001", country: "Portugal" },
    });
    expect(calls[0]!.url).toContain("/transports.json?");
    expect(Object.keys(calls[0]!.body as object)).toEqual(["transport"]);
    const fin = await client.changeState("transport", 9, "finalized");
    expect(calls[1]!.url).toContain("/transports/9/change-state.json");
    expect(calls[1]!.body).toEqual({ transport: { state: "finalized" } });
    expect(fin?.at_doc_code_id).toBe("123456");
    await client.changeState("invoice_receipt", 55, "canceled", "Erro no NIF");
    expect(calls[2]!.url).toContain("/invoice_receipts/55/change-state.json");
    expect(calls[2]!.body).toEqual({ invoice: { state: "canceled", message: "Erro no NIF" } });
  });

  it("PDF: espera enquanto está a ser gerado (202) e devolve o pdfUrl", async () => {
    vi.useFakeTimers();
    const { fn } = fakeFetch([
      { status: 202, body: { pdf: { message: "PDF file is being generated" } } },
      { status: 200, body: { output: { pdfUrl: "https://cdn.invoicexpress.com/x.pdf" } } },
    ]);
    const p = new ix.InvoiceXpress("conta", "k", fn).pdfUrl(55);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toBe("https://cdn.invoicexpress.com/x.pdf");
    vi.useRealTimers();
  });

  it("traduz os erros e tenta de novo quando está sobrecarregado", async () => {
    const auth = fakeFetch([{ status: 401, body: { errors: [{ error: "Authentication Error" }] } }]);
    await expect(new ix.InvoiceXpress("conta", "k", auth.fn).listTaxes()).rejects.toMatchObject({ code: "auth" });
    const invalid = fakeFetch([{ status: 422, body: { errors: [{ error: "Date can't be blank" }] } }]);
    await expect(new ix.InvoiceXpress("conta", "k", invalid.fn).listTaxes()).rejects.toMatchObject({ code: "invalid", message: "Date can't be blank" });
    vi.useFakeTimers();
    const busy = fakeFetch([{ status: 429 }, { status: 200, body: { taxes: [{ id: 1, name: "IVA23", value: "23.0", region: "PT", default_tax: 1 }] } }]);
    const p = new ix.InvoiceXpress("conta", "k", busy.fn).listTaxes();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toHaveLength(1);
    vi.useRealTimers();
    expect(() => new ix.InvoiceXpress("conta.evil.com/", "k")).toThrow();
  });

  it("valores, datas e hora de Portugal", () => {
    expect(ix.toMinor(123.45)).toBe(12345n);
    expect(ix.toMinor("0.005")).toBe(1n);
    expect(ix.toMinor(null)).toBeNull();
    expect(ix.fromMinor(12345n)).toBe(123.45);
    expect(ix.ixDate("2026-11-22")).toBe("22/11/2026");
    // Inverno: Lisboa = UTC; verão: UTC+1.
    expect(ix.lisbonLocalToUtc("2026-01-15T10:30").toISOString()).toBe("2026-01-15T10:30:00.000Z");
    expect(ix.lisbonLocalToUtc("2026-07-15T10:30").toISOString()).toBe("2026-07-15T09:30:00.000Z");
    expect(ix.ixDateTime(new Date("2026-07-15T09:30:00Z"))).toBe("15/07/2026 10:30:00");
  });
});

describe("cifra da chave", () => {
  it("cifra e decifra; outro texto cifrado é diferente; alterado falha", () => {
    const a = crypto.encryptSecret("segredo-da-api");
    const b = crypto.encryptSecret("segredo-da-api");
    expect(a).not.toBe(b);
    expect(a).not.toContain("segredo");
    expect(crypto.decryptSecret(a)).toBe("segredo-da-api");
    const parts = a.split(".");
    parts[3] = Buffer.from("outra-coisa").toString("base64url");
    expect(() => crypto.decryptSecret(parts.join("."))).toThrow();
  });
});
