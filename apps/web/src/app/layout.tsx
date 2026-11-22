import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Inter, Manrope } from "next/font/google";
import { cookies } from "next/headers";
import { a11yDataAttributes, A11Y_COOKIE, parseA11y } from "@/lib/a11y";
import { parseTextSize, parseTheme, TEXT_COOKIE, THEME_COOKIE } from "@/lib/appearance";
import { getLocale } from "@/lib/i18n";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-manrope", display: "swap" });
// Letra de leitura fácil (Acessibilidade): só é descarregada por quem a liga (sem preload).
const readable = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-readable", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "ANEN", template: "%s · ANEN" },
  description: "Finanças, orçamentos e serviços para profissionais, empresas e clientes.",
  robots: { index: false, follow: false },
};

// As funções correm em Dublin, junto da base de dados (Supabase eu-west-1): cada consulta deixa de atravessar o Atlântico.
export const preferredRegion = "dub1";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090909" },
    { media: "(prefers-color-scheme: light)", color: "#f5f4f1" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, cookieStore] = await Promise.all([getLocale(), cookies()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const text = parseTextSize(cookieStore.get(TEXT_COOKIE)?.value);
  const a11y = a11yDataAttributes(parseA11y(cookieStore.get(A11Y_COOKIE)?.value));
  return (
    <html lang={locale} data-theme={theme} data-text={text} {...a11y} className={`${inter.variable} ${manrope.variable} ${readable.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
