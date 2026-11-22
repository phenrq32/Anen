/**
 * Tokens de design partilhados entre web (Tailwind, via theme.css) e mobile (React Native).
 * Os componentes são implementados em cada app; só os tokens são comuns.
 */
export const colors = {
  black: "#090909",
  surface: "#141414",
  graphite: "#202020",
  graphiteSoft: "#353535",
  line: "#2A2A2A",
  white: "#FFFFFF",
  textMuted: "#A3A3A3",
  textSubtle: "#737373",
  orange: "#FF851B",
  orangeHover: "#FF9A42",
  orangeInk: "#090909",
  success: "#3DD68C",
  danger: "#FF5C5C",
  warning: "#FFC53D",
  dangerSoft: "#FFB3B3",
  successSoft: "#A6F0C9",
} as const;

/**
 * Tema claro (escolhido pela pessoa em Definições → Aparência). O laranja continua igual nos fundos e botões
 * (com texto preto); texto laranja passa a laranja-escuro para ter contraste sobre branco.
 */
export const lightColors = {
  black: "#F5F4F1",
  surface: "#FFFFFF",
  graphite: "#EFEDE9",
  graphiteSoft: "#DEDAD4",
  line: "#E3E0DA",
  white: "#141414",
  textMuted: "#4F4F4F",
  textSubtle: "#6B6B6B",
  orange: "#FF851B",
  orangeText: "#B45309",
  success: "#15803D",
  danger: "#DC2626",
  warning: "#B45309",
  dangerSoft: "#991B1B",
  successSoft: "#166534",
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

export const fonts = {
  heading: "Manrope",
  body: "Inter",
} as const;

export type ColorToken = keyof typeof colors;
