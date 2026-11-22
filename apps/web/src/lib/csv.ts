/**
 * Neutraliza fórmulas (=, +, -, @) ao abrir o CSV numa folha de cálculo.
 * Números puros ("-45.90") passam intactos para continuarem a ser números.
 */
export function csvCell(value: string): string {
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !numeric && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV com BOM (o Excel reconhece UTF-8) e ";" como separador, habitual em pt-PT e pt-BR. */
export function csvBody(header: string[], lines: string[][]): string {
  return "﻿" + [header, ...lines].map((l) => l.map(csvCell).join(";")).join("\r\n");
}
