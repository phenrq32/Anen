import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { QuoteDocumentModel } from "./quote-document";

/**
 * PDF do orçamento para o cliente, gerado no servidor (funciona em qualquer telemóvel, incluindo a app
 * instalada no iPhone, onde "Imprimir" do navegador não está disponível). Mesmo conteúdo da página
 * /imprimir/orcamento/[id]: preços agrupados por serviço com subtotal, nunca custos nem margem.
 * Puro: recebe textos já traduzidos e valores já formatados por quem chama.
 */
export interface QuotePdfInput {
  fonts: { regular: Uint8Array; bold: Uint8Array; heading: Uint8Array };
  labels: {
    title: string;
    client: string;
    quoteTitle: string;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    otherLines: string;
    conditions: string;
    disclaimer: string;
    page: (page: number, pages: number) => string;
  };
  issuer: { name: string; taxId: string | null; email: string };
  number: string;
  dates: string[];
  client: { name: string; lines: string[] };
  quoteTitle: string;
  quoteDescription: string | null;
  model: QuoteDocumentModel;
  money: (minor: bigint) => string;
  quantity: (q: string, unit: string | null) => string;
  totals: { label: string; value: string; strong?: boolean }[];
  conditions: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.353, 0.353, 0.353);
const LINE = rgb(0.894, 0.886, 0.871);
const ORANGE = rgb(0.878, 0.416, 0.063); // #E06A10: laranja da marca escurecido para texto pequeno em fundo branco

/** Substitui caracteres que a fonte não tem (ex.: "≈") para não aparecerem quadrados. */
function safeText(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  const map: Record<string, string> = { "≈": "~", "→": "->", "←": "<-", "✕": "x", " ": " " };
  return [...text].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : (map[ch] ?? (ch === "\n" ? ch : "?")))).join("");
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of safeText(font, text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) out.push(line);
        // Palavra maior do que a largura: parte por caracteres.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(input.fonts.regular, { subset: true });
  const bold = await pdf.embedFont(input.fonts.bold, { subset: true });
  const heading = await pdf.embedFont(input.fonts.heading, { subset: true });
  pdf.setTitle(`${input.labels.title} ${input.number}`);
  pdf.setAuthor(input.issuer.name);
  pdf.setCreator("ANEN");

  const width = A4[0] - MARGIN * 2;
  // Colunas: descrição | qtd. | preço unit. | valor
  const colAmount = A4[0] - MARGIN;
  const colUnit = colAmount - 92;
  const colQty = colUnit - 92;
  const descWidth = colQty - 70 - MARGIN;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const text = (s: string, x: number, size: number, font: PDFFont = regular, color = INK) => page.drawText(safeText(font, s), { x, y, size, font, color });
  const right = (s: string, xRight: number, size: number, font: PDFFont = regular, color = INK) => {
    const t = safeText(font, s);
    page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color });
  };
  const rule = (thickness = 0.6, color = LINE) => page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness, color });
  const tableHeader = () => {
    text(input.labels.description.toUpperCase(), MARGIN, 7.5, bold, MUTED);
    right(input.labels.quantity.toUpperCase(), colQty, 7.5, bold, MUTED);
    right(input.labels.unitPrice.toUpperCase(), colUnit, 7.5, bold, MUTED);
    right(input.labels.amount.toUpperCase(), colAmount, 7.5, bold, MUTED);
    y -= 6;
    rule(1, INK);
    y -= 14;
  };
  /** Garante espaço; se não houver, abre página nova (com o cabeçalho da tabela quando pedido). */
  const ensure = (needed: number, withHeader = false) => {
    if (y - needed >= MARGIN + 24) return;
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
    text(`${input.labels.title} ${input.number}`, MARGIN, 8, regular, MUTED);
    y -= 20;
    if (withHeader) tableHeader();
  };

  // Cabeçalho: emitente à esquerda, número e datas à direita.
  const top = y;
  for (const [i, l] of wrap(heading, 17, input.issuer.name, width * 0.55).entries()) {
    text(l, MARGIN, 17, heading);
    y -= i === 0 ? 16 : 19;
  }
  for (const l of [input.issuer.taxId, input.issuer.email].filter((v): v is string => Boolean(v))) {
    y -= 2;
    text(l, MARGIN, 9, regular, MUTED);
    y -= 11;
  }
  const leftBottom = y;
  y = top;
  right(input.labels.title.toUpperCase(), A4[0] - MARGIN, 9, bold, ORANGE);
  y -= 18;
  right(input.number, A4[0] - MARGIN, 15, bold);
  for (const d of input.dates) {
    y -= 14;
    right(d, A4[0] - MARGIN, 9, regular, MUTED);
  }
  y = Math.min(y, leftBottom) - 12;
  rule(1.6, INK);
  y -= 22;

  // Cliente e título.
  const half = width / 2 - 12;
  const blockTop = y;
  text(input.labels.client.toUpperCase(), MARGIN, 7.5, bold, MUTED);
  y -= 14;
  text(input.client.name || "—", MARGIN, 10.5, bold);
  for (const l of input.client.lines) {
    for (const w of wrap(regular, 9, l, half)) {
      y -= 12;
      text(w, MARGIN, 9);
    }
  }
  const clientBottom = y;
  y = blockTop;
  const x2 = MARGIN + width / 2 + 12;
  text(input.labels.quoteTitle.toUpperCase(), x2, 7.5, bold, MUTED);
  y -= 14;
  for (const [i, l] of wrap(bold, 10.5, input.quoteTitle, half).entries()) {
    if (i) y -= 13;
    text(l, x2, 10.5, bold);
  }
  if (input.quoteDescription) {
    for (const l of wrap(regular, 8.5, input.quoteDescription, half)) {
      y -= 11.5;
      text(l, x2, 8.5, regular, MUTED);
    }
  }
  y = Math.min(y, clientBottom) - 28;

  // Linhas agrupadas por serviço.
  tableHeader();
  const grouped = input.model.groups.some((g) => g.section !== null) && input.model.groups.length > 1;
  for (const g of input.model.groups) {
    const title = g.section ?? (grouped ? input.labels.otherLines : null);
    if (title) {
      const titleLines = wrap(heading, 10.5, title, colUnit - MARGIN - 20);
      ensure(14 * titleLines.length + 30, true);
      for (const [i, l] of titleLines.entries()) {
        text(l, MARGIN, 10.5, heading);
        if (i === 0) right(input.money(g.subtotalMinor), colAmount, 10.5, bold);
        y -= 14;
      }
      y -= 2;
    }
    const indent = title ? 10 : 0;
    for (const l of g.lines) {
      const desc = wrap(regular, 9, l.description, descWidth - indent);
      ensure(12 * desc.length + 6, true);
      for (const [i, d] of desc.entries()) {
        text(d, MARGIN + indent, 9, regular, title ? rgb(0.17, 0.17, 0.17) : INK);
        if (i === 0) {
          right(input.quantity(l.quantity, l.unit), colQty, 9);
          right(input.money(l.unitPriceMinor), colUnit, 9);
          right(input.money(l.amountMinor), colAmount, 9, bold);
        }
        y -= 12;
      }
      y -= 2;
    }
    y += 4;
    rule();
    y -= 14;
  }

  // Totais à direita.
  y -= 6;
  ensure(16 * input.totals.length + 20);
  const totalsLeft = A4[0] - MARGIN - 230;
  for (const t of input.totals) {
    if (t.strong) {
      y -= 2;
      page.drawLine({ start: { x: totalsLeft, y: y + 12 }, end: { x: A4[0] - MARGIN, y: y + 12 }, thickness: 1.6, color: INK });
      y -= 4;
      text(t.label, totalsLeft, 11.5, bold);
      right(t.value, A4[0] - MARGIN, 11.5, bold);
    } else {
      text(t.label, totalsLeft, 9, regular, MUTED);
      right(t.value, A4[0] - MARGIN, 9);
    }
    y -= 15;
  }

  if (input.conditions) {
    y -= 18;
    const lines = wrap(regular, 9, input.conditions, width);
    ensure(24 + 12 * Math.min(lines.length, 4));
    text(input.labels.conditions.toUpperCase(), MARGIN, 7.5, bold, MUTED);
    y -= 14;
    for (const l of lines) {
      ensure(12);
      text(l, MARGIN, 9);
      y -= 12;
    }
  }

  // Rodapé em todas as páginas: aviso e número da página.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 6 }, end: { x: A4[0] - MARGIN, y: MARGIN + 6 }, thickness: 0.6, color: LINE });
    p.drawText(safeText(regular, input.labels.disclaimer), { x: MARGIN, y: MARGIN - 8, size: 7.5, font: regular, color: MUTED });
    const label = safeText(regular, input.labels.page(i + 1, pages.length));
    p.drawText(label, { x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 7.5), y: MARGIN - 8, size: 7.5, font: regular, color: MUTED });
  });

  return pdf.save();
}
