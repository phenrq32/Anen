import { describe, expect, it } from "vitest";
import { getMessages } from "@anen/i18n";
import { errorMessage, translateFieldErrors } from "./errors";

const m = getMessages("pt-PT");

describe("errorMessage", () => {
  it("traduz chaves levantadas pelas funções SQL", () => {
    expect(errorMessage(m, { message: "last_owner" })).toBe(m.errors.last_owner);
    expect(errorMessage(m, { message: "tax_id_invalid" })).toBe(m.errors.tax_id_invalid);
  });

  it("não expõe detalhes técnicos", () => {
    expect(errorMessage(m, { message: 'duplicate key value violates unique constraint "x"' })).toBe(m.errors.generic);
    expect(errorMessage(m, { message: "permission denied for table organizations" })).toBe(m.errors.forbidden);
    expect(errorMessage(m, { message: "x", status: 429 })).toBe(m.errors.rateLimited);
    expect(errorMessage(m, null)).toBe(m.errors.generic);
  });

  it("não confunde propriedades herdadas com chaves", () => {
    expect(errorMessage(m, { message: "constructor" })).toBe(m.errors.generic);
  });

  it("traduz erros de campo", () => {
    expect(translateFieldErrors(m, { email: "email_invalid", x: "desconhecido" })).toEqual({
      email: m.errors.email_invalid,
      x: m.errors.generic,
    });
  });
});
