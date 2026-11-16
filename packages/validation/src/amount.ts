/**
 * Converte um valor escrito pelo utilizador ("1.234,56", "1234.56", "1 234,5", "-20")
 * em unidades mínimas inteiras, sem ponto flutuante. Devolve null se for ambíguo ou inválido.
 *
 * Regras: com "," e "." o último é o separador decimal; uma vírgula isolada é sempre decimal;
 * um ponto isolado é decimal se tiver até `minorUnit` casas, senão separador de milhares
 * (todos os grupos seguintes com 3 dígitos).
 */
export const MAX_SAFE_MINOR = 9007199254740991n;

export function parseAmountInput(input: string, minorUnit: number, { allowNegative = false } = {}): bigint | null {
  let value = input.trim().replace(/[\s  ]/g, "").replace(/^(€|R\$|US\$|\$)/, "").replace(/(€|R\$)$/, "");
  if (!value) return null;
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }
  if (!/^[0-9.,]+$/.test(value) || !/[0-9]/.test(value)) return null;

  let intPart: string;
  let fracPart = "";
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    const [int = "", frac = "", ...rest] = value.split(decimalSep);
    if (rest.length) return null;
    if (!isGrouped(int, thousandSep)) return null;
    intPart = int.split(thousandSep).join("");
    fracPart = frac;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = value.split(sep);
    if (parts.length === 2 && (sep === "," || ((parts[1] ?? "").length <= minorUnit && (parts[1] ?? "").length > 0))) {
      // Em pt-PT/pt-BR uma vírgula isolada é sempre decimal ("10,005" é recusado, não lido como 10005).
      intPart = parts[0] || "0";
      fracPart = parts[1] ?? "";
    } else if (isGrouped(value, sep)) {
      intPart = parts.join("");
    } else {
      return null;
    }
  } else {
    intPart = value;
  }

  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart) || fracPart.length > minorUnit) return null;
  const minor = BigInt(intPart) * 10n ** BigInt(minorUnit) + BigInt(fracPart.padEnd(minorUnit, "0") || "0");
  if (minor > MAX_SAFE_MINOR) return null;
  if (negative && !allowNegative) return null;
  return negative ? -minor : minor;
}

function isGrouped(value: string, sep: string): boolean {
  const groups = value.split(sep);
  if (groups.length === 1) return /^\d+$/.test(value);
  const [first = "", ...rest] = groups;
  return /^\d{1,3}$/.test(first) && rest.every((g) => /^\d{3}$/.test(g));
}

/** Representação para preencher um campo de edição (sem separador de milhares). */
export function formatAmountInput(minor: bigint, minorUnit: number, decimalSeparator: "," | "." = ","): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(minorUnit + 1, "0");
  const body = minorUnit === 0 ? digits : `${digits.slice(0, -minorUnit)}${decimalSeparator}${digits.slice(-minorUnit)}`;
  return `${negative ? "-" : ""}${body}`;
}
