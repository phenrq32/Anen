import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  isValidCnpj,
  isValidCpf,
  isValidPortugueseNif,
  organizationSchema,
  resetPasswordSchema,
  safeNextPath,
  signUpSchema,
} from "./index";

describe("números fiscais", () => {
  it("NIF português", () => {
    expect(isValidPortugueseNif("123456789")).toBe(true);
    expect(isValidPortugueseNif("123 456 789")).toBe(true);
    expect(isValidPortugueseNif("123456780")).toBe(false);
    expect(isValidPortugueseNif("412345678")).toBe(false); // prefixo não atribuído
    expect(isValidPortugueseNif("12345678")).toBe(false);
  });

  it("CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("CNPJ numérico e alfanumérico", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
    // Exemplo oficial da Receita Federal para o CNPJ alfanumérico
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
  });
});

describe("esquemas", () => {
  it("registo exige termos, palavra-passe forte e email válido", () => {
    const result = signUpSchema.safeParse({ fullName: "A", email: "x", password: "curta", acceptTerms: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toMatchObject({
        fullName: "name_required",
        email: "email_invalid",
        password: "password_too_short",
        acceptTerms: "terms_required",
      });
    }
  });

  it("normaliza o email", () => {
    const result = signUpSchema.parse({
      fullName: "Ana Costa",
      email: "  Ana@Exemplo.PT ",
      password: "segura12345",
      acceptTerms: true,
    });
    expect(result.email).toBe("ana@exemplo.pt");
  });

  it("confirmação de palavra-passe", () => {
    const r = resetPasswordSchema.safeParse({ password: "segura12345", confirmPassword: "outra12345" });
    expect(r.success).toBe(false);
  });

  it("organização valida o número fiscal pelo país", () => {
    const base = { kind: "business", name: "Oficina Lda", countryCode: "PT", currencyCode: "EUR", timezone: "Europe/Lisbon" };
    expect(organizationSchema.safeParse({ ...base, taxId: "123456789" }).success).toBe(true);
    expect(organizationSchema.safeParse({ ...base, taxId: "11222333000181" }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...base, countryCode: "BR", currencyCode: "BRL", timezone: "America/Sao_Paulo", taxId: "11.222.333/0001-81" }).data?.taxId).toBe("11222333000181");
    expect(organizationSchema.safeParse({ ...base, timezone: "Marte/Olympus" }).success).toBe(false);
    expect(organizationSchema.parse({ ...base, taxId: "", regionId: "" })).toMatchObject({ taxId: null, regionId: null });
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/painel", "/painel"],
    ["/organizacao/membros?x=1", "/organizacao/membros?x=1"],
    ["https://evil.example", "/painel"],
    ["//evil.example", "/painel"],
    ["/\\evil.example", "/painel"],
    ["javascript:alert(1)", "/painel"],
    [null, "/painel"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
