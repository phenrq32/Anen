import { parseAmountInput } from "./amount";

/**
 * Leitura de extratos bancários (CSV e OFX) sem dependências: tudo determinístico e testado.
 * Valores com sinal em unidades mínimas (bigint): negativo = saída de dinheiro (despesa).
 */

export interface StatementRow {
  /** AAAA-MM-DD */
  occurredOn: string;
  description: string;
  /** Com sinal: < 0 despesa, > 0 receita. Nunca 0. */
  amountMinor: bigint;
  /** Identifica a linha para não duplicar: FITID do OFX ou impressão digital no CSV. */
  ref: string;
}

export interface CsvTable {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

export interface CsvMapping {
  date: number;
  description: number;
  /** Uma coluna com sinal… */
  amount?: number | undefined;
  /** …ou duas colunas, débito e crédito (valores positivos). */
  debit?: number | undefined;
  credit?: number | undefined;
}

export const MAX_STATEMENT_ROWS = 2000;

/** Texto → AAAA-MM-DD. Aceita dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, dd/mm/aa, aaaa-mm-dd e aaaammdd (OFX). */
export function parseBankDate(input: string): string | null {
  const s = input.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(s))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return t.toISOString().startsWith(iso) ? iso : null;
}

/**
 * Valor de extrato → unidades mínimas com sinal. Aceita "1.234,56", "1,234.56", "-45,90", "45,90-",
 * "(45,90)", "+1200", "€ 3,50", "R$ 3,50" e um "D"/"C" no fim (débito/crédito).
 */
export function parseBankAmount(input: string, minorUnit: number): bigint | null {
  let s = input.trim().replace(/[\s  ]/g, "");
  if (!s) return null;
  let negative = false;
  const dc = /([DdCc])$/.exec(s);
  if (dc) {
    negative = dc[1]!.toUpperCase() === "D";
    s = s.slice(0, -1);
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(EUR|BRL|€|R\$|US\$|\$)/i, "").replace(/(EUR|BRL|€|R\$)$/i, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const v = parseAmountInput(s, minorUnit);
  if (v === null) return null;
  return negative ? -v : v;
}

/** Divide um CSV respeitando aspas ("a;b" fica numa célula, "" é uma aspa). Escolhe ; , ou tab pelo cabeçalho. */
export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, "");
  const firstLines = clean.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  const count = (d: string) => firstLines.reduce((n, l) => n + splitLine(l, d).length, 0);
  const delimiter = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0]!;
  const lines: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) lines.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) lines.push(row);
  // O cabeçalho é a primeira linha sem data na 1.ª coluna que antecede linhas com data (os bancos põem títulos antes).
  let headerIndex = 0;
  for (let i = 0; i < Math.min(lines.length - 1, 15); i++) {
    const next = lines[i + 1]!;
    if (!lines[i]!.some((c) => parseBankDate(c)) && next.some((c) => parseBankDate(c)) && lines[i]!.length >= 2) {
      headerIndex = i;
      break;
    }
  }
  const headers = lines[headerIndex] ?? [];
  const rows = lines.slice(headerIndex + 1).filter((r) => r.length >= 2);
  return { delimiter, headers, rows };
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === d && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Adivinha as colunas pelo nome do cabeçalho e, na falta, pelo conteúdo. */
export function guessCsvMapping(table: CsvTable): CsvMapping | null {
  const h = table.headers.map(norm);
  // Procura por ordem de preferência das palavras; ignora colunas com palavras excluídas.
  const find = (words: string[], exclude: string[] = []) => {
    for (const w of words) {
      const i = h.findIndex((x) => x.includes(w) && !exclude.some((e) => x.includes(e)));
      if (i >= 0) return i;
    }
    return -1;
  };
  let date = find(["data mov", "data lanc", "data", "date", "dt"]);
  let description = find(["descri", "historico", "hist", "detalhe", "memo", "lancamento", "designa", "movimento"], ["data"]);
  const debit = find(["debito", "debit", "saida"], ["data"]);
  const credit = find(["credito", "credit", "entrada"], ["data"]);
  let amount = find(["montante", "valor", "quantia", "amount", "importancia"], ["data", "saldo", "balance"]);
  const sample = table.rows.slice(0, 20);
  const columns = Math.max(0, ...table.rows.map((r) => r.length));
  const share = (col: number, ok: (s: string) => boolean) =>
    sample.length ? sample.filter((r) => r[col] !== undefined && r[col] !== "" && ok(r[col]!)).length / sample.length : 0;
  if (date < 0 || share(date, (s) => parseBankDate(s) !== null) < 0.6) {
    date = [...Array(columns).keys()].find((c) => share(c, (s) => parseBankDate(s) !== null) >= 0.8) ?? -1;
  }
  if (date < 0) return null;
  const isMoney = (s: string) => parseBankAmount(s, 2) !== null;
  const twoColumns = debit >= 0 && credit >= 0 && debit !== credit;
  if (!twoColumns && (amount < 0 || amount === date || share(amount, isMoney) < 0.6)) {
    // A coluna de valor mais à esquerda depois da data (o saldo costuma vir no fim).
    const saldo = h.findIndex((x) => x.includes("saldo") || x.includes("balance"));
    amount = [...Array(columns).keys()].find((c) => c !== date && c !== saldo && share(c, isMoney) >= 0.6) ?? -1;
  }
  if (description < 0 || description === date || description === amount) {
    description = [...Array(columns).keys()].find(
      (c) => c !== date && c !== amount && share(c, (s) => /[a-z]/i.test(s) && !isMoney(s)) >= 0.6,
    ) ?? -1;
  }
  if (description < 0) return null;
  if (twoColumns) return { date, description, debit, credit };
  if (amount < 0) return null;
  return { date, description, amount };
}

/** Aplica o mapeamento: devolve as linhas válidas e os números (1-based, sem o cabeçalho) das que falharam. */
export function csvToStatement(table: CsvTable, mapping: CsvMapping, minorUnit: number): { rows: StatementRow[]; invalid: number[] } {
  const rows: StatementRow[] = [];
  const invalid: number[] = [];
  const seen = new Map<string, number>();
  table.rows.slice(0, MAX_STATEMENT_ROWS).forEach((r, i) => {
    const occurredOn = parseBankDate(r[mapping.date] ?? "");
    const description = (r[mapping.description] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    let amount: bigint | null = null;
    if (mapping.amount !== undefined) amount = parseBankAmount(r[mapping.amount] ?? "", minorUnit);
    else if (mapping.debit !== undefined && mapping.credit !== undefined) {
      const d = (r[mapping.debit] ?? "").trim() ? parseBankAmount(r[mapping.debit]!, minorUnit) : 0n;
      const c = (r[mapping.credit] ?? "").trim() ? parseBankAmount(r[mapping.credit]!, minorUnit) : 0n;
      amount = d === null || c === null ? null : (c < 0n ? -c : c) - (d < 0n ? -d : d);
    }
    if (!occurredOn || !description || amount === null || amount === 0n) {
      invalid.push(i + 1);
      return;
    }
    const base = `${occurredOn}|${amount}|${norm(description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ occurredOn, description, amountMinor: amount, ref: `csv:${base}|${n}`.slice(0, 200) });
  });
  return { rows, invalid };
}

/** OFX (SGML ou XML): lê cada <STMTTRN> (DTPOSTED, TRNAMT, FITID, NAME/MEMO). */
export function ofxToStatement(text: string, minorUnit: number): { rows: StatementRow[]; invalid: number[] } {
  const rows: StatementRow[] = [];
  const invalid: number[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1, MAX_STATEMENT_ROWS + 1);
  const tag = (block: string, name: string) => {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
    return m ? m[1]!.trim() : "";
  };
  const seen = new Map<string, number>();
  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0]!;
    const occurredOn = parseBankDate(tag(block, "DTPOSTED"));
    const amountText = tag(block, "TRNAMT");
    // No OFX o ponto é sempre decimal; vírgulas aparecem em alguns bancos brasileiros.
    const amount = parseBankAmount(amountText.includes(",") ? amountText : amountText.replace(/\./g, ","), minorUnit);
    const description = [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" · ").replace(/\s+/g, " ").trim().slice(0, 200);
    const fitid = tag(block, "FITID");
    if (!occurredOn || amount === null || amount === 0n || !description) {
      invalid.push(i + 1);
      return;
    }
    const base = `${occurredOn}|${amount}|${norm(description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ occurredOn, description, amountMinor: amount, ref: (fitid ? `ofx:${fitid}` : `ofx:${base}|${n}`).slice(0, 200) });
  });
  return { rows, invalid };
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 4000));
}
