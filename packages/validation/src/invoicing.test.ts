import { describe, expect, it } from "vitest";
import { fiscalDocumentSchema, invoicingConnectionSchema } from "./invoicing";

const base = {
  kind: "invoice",
  clientName: "Café Azul",
  issueDate: "2026-11-22",
  lines: [{ name: "Serviço", quantity: "2", unitPrice: "50,00", taxName: "IVA23", discount: "0" }],
};

describe("validação da faturação", () => {
  it("conta InvoiceXpress: só um subdomínio simples", () => {
    expect(invoicingConnectionSchema.parse({ accountName: " MinhaEmpresa ", apiKey: "0123456789abcdef" }).accountName).toBe("minhaempresa");
    expect(invoicingConnectionSchema.safeParse({ accountName: "a.b/c", apiKey: "0123456789abcdef" }).success).toBe(false);
    expect(invoicingConnectionSchema.safeParse({ accountName: "conta", apiKey: "curta" }).success).toBe(false);
  });

  it("NIF português validado; consumidor final sem NIF", () => {
    expect(fiscalDocumentSchema.safeParse(base).success).toBe(true);
    expect(fiscalDocumentSchema.safeParse({ ...base, clientFiscalId: "123456789" }).success).toBe(true);
    expect(fiscalDocumentSchema.safeParse({ ...base, clientFiscalId: "123456788" }).error?.issues[0]?.message).toBe("tax_id_invalid");
    // Cliente estrangeiro: o NIF não segue a regra portuguesa.
    expect(fiscalDocumentSchema.safeParse({ ...base, clientFiscalId: "B12345678", clientCountry: "Espanha" }).success).toBe(true);
  });

  it("linhas, vencimento e desconto", () => {
    expect(fiscalDocumentSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(fiscalDocumentSchema.safeParse({ ...base, dueDate: "2026-11-01" }).error?.issues[0]?.message).toBe("date_invalid");
    expect(fiscalDocumentSchema.safeParse({ ...base, lines: [{ ...base.lines[0], quantity: "0" }] }).success).toBe(false);
    expect(fiscalDocumentSchema.safeParse({ ...base, lines: [{ ...base.lines[0], discount: "150" }] }).success).toBe(false);
    expect(fiscalDocumentSchema.safeParse({ ...base, lines: [{ ...base.lines[0], name: "x".repeat(61) }] }).success).toBe(false);
  });

  it("guias exigem início do transporte e moradas de carga e descarga", () => {
    const guide = { ...base, kind: "transport" };
    const msgs = fiscalDocumentSchema.safeParse(guide).error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(msgs).toEqual(expect.arrayContaining(["loadedAt", "addressFrom", "addressTo"]));
    const addr = { detail: "Rua A, 1", city: "Lisboa", postalCode: "1000-001", country: "Portugal" };
    expect(fiscalDocumentSchema.safeParse({ ...guide, loadedAt: "2026-11-23T09:00", addressFrom: addr, addressTo: addr }).success).toBe(true);
  });
});
