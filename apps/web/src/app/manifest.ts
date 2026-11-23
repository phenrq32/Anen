import type { MetadataRoute } from "next";

/** App instalável (PWA): ícone no ecrã principal, abre em ecrã inteiro no painel. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/painel",
    name: "ANEN — Finanças e negócio",
    short_name: "ANEN",
    description: "Finanças pessoais e da empresa, orçamentos, stock e faturação num só lugar.",
    lang: "pt",
    start_url: "/painel?origem=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#090909",
    theme_color: "#090909",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Registar movimento", short_name: "Registar", url: "/financas?registar=1", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Novo orçamento", short_name: "Orçamento", url: "/orcamentos/novo", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Notificações", url: "/notificacoes", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
