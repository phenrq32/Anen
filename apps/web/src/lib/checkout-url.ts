/** Procura o link na resposta, seja qual for o nome do campo (a documentação não o fixa). */
export function findCheckoutUrl(data: unknown): string | null {
  if (typeof data === "string") return data.startsWith("https://") ? data : null;
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const k of ["url", "link", "checkout_url", "payment_url", "invoice_url"]) {
    const v = obj[k];
    if (typeof v === "string" && v.startsWith("https://")) return v;
  }
  for (const v of Object.values(obj)) {
    const found = findCheckoutUrl(v);
    if (found) return found;
  }
  return null;
}
