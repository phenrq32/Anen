/** Quantidade decimal ("12.500") formatada para leitura ("12,5"). Só para mostrar; os cálculos usam o texto exato. */
export function formatQuantity(value: string | number, locale: string, signed = false): string {
  const n = Number(value);
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Math.abs(n));
  if (!signed) return n < 0 ? `−${text}` : text;
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : text;
}
