/**
 * Aceita apenas caminhos internos para redirecionamentos pós-login (evita open redirect).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/painel"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(value) || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "https://anen.invalid");
    if (url.origin !== "https://anen.invalid") return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
