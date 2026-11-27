import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@anen/i18n";
import { buildQuoteDocument } from "./quote-document";
import { renderQuotePdf, type QuotePdfInput } from "./quote-pdf";

const fonts = join(__dirname, "../assets/fonts");
const read = (f: string) => new Uint8Array(readFileSync(join(fonts, f)));

function samplePdfInput(lines = 6): QuotePdfInput {
  const items = [
    { section: "Pintura de T2 completo (paredes + tetos)", description: "Tinta", cost: 60000n, q: "2", u: "imóvel", n: "product" as const },
    { section: "Pintura de T2 completo (paredes + tetos)", description: "Primário / selante", cost: 18000n, q: "2", u: "imóvel", n: "product" as const },
    { section: "Pintura de T2 completo (paredes + tetos)", description: "Fita, lixas, plásticos de proteção", cost: 8000n, q: "2", u: "imóvel", n: "product" as const },
    { section: "Pintura de T2 completo (paredes + tetos)", description: "Pintura", cost: 140000n, q: "2", u: "imóvel", n: "service" as const },
    { section: "Pintura de portas (2 faces, esmalte)", description: "Tinta", cost: 3000n, q: "4", u: "unidade", n: "product" as const },
    { section: "Pintura de portas (2 faces, esmalte)", description: "Deslocação", cost: 1000n, q: "4", u: "unidade", n: "service" as const },
  ];
  const all = Array.from({ length: lines }, (_, i) => ({ ...items[i % items.length]!, section: `${items[i % items.length]!.section}${i >= items.length ? ` ${Math.floor(i / items.length)}` : ""}` }));
  const total = all.reduce((s, l) => s + l.cost, 0n);
  const model = buildQuoteDocument({
    currency: "EUR",
    priceBeforeTaxMinor: total,
    discountMinor: 0n,
    lines: all.map((l, i) => ({ id: String(i), section: l.section, description: l.description, nature: l.n, quantity: l.q, unit: l.u, totalCostMinor: l.cost })),
  });
  const money = (v: bigint) => formatMoney(v, "EUR", 2, "pt-PT");
  return {
    fonts: { regular: read("inter-latin-400-normal.woff"), bold: read("inter-latin-700-normal.woff"), heading: read("manrope-latin-800-normal.woff") },
    labels: {
      title: "Orçamento",
      client: "Cliente",
      quoteTitle: "Título",
      description: "Descrição",
      quantity: "Qtd.",
      unitPrice: "Preço unit.",
      amount: "Valor",
      otherLines: "Outros",
      conditions: "Condições",
      disclaimer: "Este documento é um orçamento e não constitui fatura.",
      page: (p, n) => `Página ${p} de ${n}`,
    },
    issuer: { name: "Pinturas Silva, Lda.", taxId: "NIF 123456789", email: "geral@example.com" },
    number: "ORC-2026-0012",
    dates: ["Emitido em 24 de nov. de 2026"],
    client: { name: "Maria Costa", lines: ["Rua das Flores, 10, Lisboa"] },
    quoteTitle: "Pintura de T2 completo (paredes + tetos) (+1)",
    quoteDescription: "Pintura de T2 completo: ≈ 200 m² de superfície, tinta gama média",
    model,
    money,
    quantity: (q, u) => `${q.replace(".", ",")}${u ? ` ${u}` : ""}`,
    totals: [
      { label: "Preço sem imposto", value: money(total) },
      { label: "IVA 23% (continente) (23 %)", value: money((total * 23n) / 100n) },
      { label: "Total", value: money(total + (total * 23n) / 100n), strong: true },
    ],
    conditions: "Pagamento: 50 % na adjudicação e 50 % no fim da obra.",
  };
}

describe("PDF do orçamento", () => {
  it("gera um PDF válido com o conteúdo agrupado", async () => {
    const bytes = await renderQuotePdf(samplePdfInput());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
    // Para ver o resultado: QUOTE_PDF_SAMPLE=/caminho/amostra.pdf npx vitest run apps/web/src/lib/quote-pdf.test.ts
    if (process.env.QUOTE_PDF_SAMPLE) writeFileSync(process.env.QUOTE_PDF_SAMPLE, bytes);
  });

  it("muitas linhas passam para páginas seguintes sem falhar", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await renderQuotePdf(samplePdfInput(120));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
