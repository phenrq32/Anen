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
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

export const fonts = {
  heading: "Manrope",
  body: "Inter",
} as const;

export type ColorToken = keyof typeof colors;
