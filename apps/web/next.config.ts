import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  transpilePackages: ["@anen/financial-engine", "@anen/i18n", "@anen/types", "@anen/ui", "@anen/validation"],
  poweredByHeader: false,
  // O PDF do orçamento lê as fontes da marca do disco (ver src/app/api/orcamentos/[id]/pdf).
  outputFileTracingIncludes: { "/api/orcamentos/[id]/pdf": ["./src/assets/fonts/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
