/**
 * Aparência escolhida pela pessoa (Definições → Aparência): tema e tamanho do texto.
 * Fica em cookies (por aparelho) para o servidor já desenhar a página certa, sem "piscar".
 * Sem "server-only": o cliente usa os mesmos valores para aplicar a mudança na hora.
 */
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const THEME_COOKIE = "anen-theme";
export const TEXT_COOKIE = "anen-text";
/** Tour de boas-vindas já visto (ou dispensado) neste aparelho. */
export const TOUR_COOKIE = "anen-tour";

export const DEFAULT_THEME: Theme = "dark";
export const DEFAULT_TEXT: TextSize = "normal";

export function parseTheme(v: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(v ?? "") ? (v as Theme) : DEFAULT_THEME;
}

export function parseTextSize(v: string | null | undefined): TextSize {
  return (TEXT_SIZES as readonly string[]).includes(v ?? "") ? (v as TextSize) : DEFAULT_TEXT;
}

/** Cookie de 1 ano escrito pelo navegador (a escolha vale já, sem esperar o servidor). */
export function clientCookie(name: string, value: string): string {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
