import { describe, expect, it } from "vitest";
import { format, formatDate, formatMoney, getMessages, localeFromAcceptLanguage } from "./index";
import { ptPT } from "./messages/pt-PT";
import { ptBR } from "./messages/pt-BR";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("pt-BR tem exatamente as mesmas chaves que pt-PT", () => {
    expect(keys(ptBR).sort()).toEqual(keys(ptPT).sort());
  });

  it("diferencia pt-PT e pt-BR", () => {
    expect(getMessages("pt-PT").auth.signIn.password).toBe("Palavra-passe");
    expect(getMessages("pt-BR").auth.signIn.password).toBe("Senha");
    expect(getMessages("en").auth.signIn.password).toBe("Palavra-passe"); // fallback até haver tradução
  });

  it("interpola valores", () => {
    expect(format("Olá, {name}", { name: "Ana" })).toBe("Olá, Ana");
    expect(format("{a} {b}", { a: 1 })).toBe("1 {b}");
  });

  it("escolhe idioma pelo Accept-Language", () => {
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("en-US,pt-PT;q=0.7")).toBe("pt-PT");
    expect(localeFromAcceptLanguage("fr-FR")).toBe("pt-PT");
    expect(localeFromAcceptLanguage(null)).toBe("pt-PT");
  });

  it("formata moeda com precisão exata", () => {
    const nbsp = / | /g;
    expect(formatMoney(123456789n, "EUR", 2, "pt-PT").replace(nbsp, " ")).toBe("1 234 567,89 €");
    expect(formatMoney(123456789n, "BRL", 2, "pt-BR").replace(nbsp, " ")).toBe("R$ 1.234.567,89");
    expect(formatMoney(-5n, "EUR", 2, "pt-PT").replace(nbsp, " ")).toBe("-0,05 €");
    // valor acima de Number.MAX_SAFE_INTEGER não perde dígitos
    expect(formatMoney(900719925474099312n, "EUR", 2, "pt-PT").replace(nbsp, " ")).toContain("9 007 199 254 740 993,12");
  });

  it("formata datas no fuso indicado", () => {
    const d = new Date("2026-01-01T00:30:00Z");
    const opts = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
    expect(formatDate(d, "pt-PT", "Europe/Lisbon", opts)).toBe("01/01/2026");
    expect(formatDate(d, "pt-BR", "America/Sao_Paulo", opts)).toBe("31/12/2025");
  });
});
