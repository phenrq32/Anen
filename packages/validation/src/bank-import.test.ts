import { describe, expect, it } from "vitest";
import { csvToStatement, guessCsvMapping, looksLikeOfx, ofxToStatement, parseBankAmount, parseBankDate, parseCsv } from "./bank-import";

describe("datas de extrato", () => {
  it("formatos de Portugal, Brasil, ISO e OFX", () => {
    expect(parseBankDate("23/11/2026")).toBe("2026-11-23");
    expect(parseBankDate("3-1-26")).toBe("2026-01-03");
    expect(parseBankDate("2026-11-23")).toBe("2026-11-23");
    expect(parseBankDate("20261123120000[-3:BRT]")).toBe("2026-11-23");
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("Saldo")).toBeNull();
  });
});

describe("valores de extrato", () => {
  it("separadores, sinais, D/C e moedas", () => {
    expect(parseBankAmount("1.234,56", 2)).toBe(123456n);
    expect(parseBankAmount("1,234.56", 2)).toBe(123456n);
    expect(parseBankAmount("-45,90", 2)).toBe(-4590n);
    expect(parseBankAmount("45,90-", 2)).toBe(-4590n);
    expect(parseBankAmount("(45,90)", 2)).toBe(-4590n);
    expect(parseBankAmount("+1200", 2)).toBe(120000n);
    expect(parseBankAmount("R$ 3,50", 2)).toBe(350n);
    expect(parseBankAmount("3,50 €", 2)).toBe(350n);
    expect(parseBankAmount("12,00 D", 2)).toBe(-1200n);
    expect(parseBankAmount("12,00C", 2)).toBe(1200n);
    expect(parseBankAmount("abc", 2)).toBeNull();
    expect(parseBankAmount("", 2)).toBeNull();
  });
});

describe("CSV", () => {
  it("extrato português com título antes do cabeçalho, ; e coluna única de montante", () => {
    const text = [
      "Extrato de conta;;;",
      "Conta: 0001;;;",
      "Data Mov.;Data Valor;Descrição;Montante;Saldo",
      '21/11/2026;21/11/2026;"COMPRA PINGO DOCE; LISBOA";-45,90;1.954,10',
      "22/11/2026;22/11/2026;TRF SALARIO;1.200,00;3.154,10",
      "22/11/2026;22/11/2026;COMPRA PINGO DOCE; LISBOA;-45,90;3.108,20",
    ].join("\r\n");
    const t = parseCsv(text);
    expect(t.delimiter).toBe(";");
    expect(t.headers[2]).toBe("Descrição");
    const mapping = guessCsvMapping(t)!;
    expect(mapping).toMatchObject({ date: 0, description: 2, amount: 3 });
    const { rows, invalid } = csvToStatement(t, mapping, 2);
    expect(rows.map((r) => [r.occurredOn, r.description, r.amountMinor])).toEqual([
      ["2026-11-21", "COMPRA PINGO DOCE; LISBOA", -4590n],
      ["2026-11-22", "TRF SALARIO", 120000n],
    ]);
    expect(invalid).toEqual([3]); // a linha sem aspas tem uma coluna a mais: o montante não é número
  });

  it("extrato brasileiro com débito e crédito em colunas, vírgula como separador", () => {
    const text = 'Data,Histórico,Débito,Crédito\n01/11/2026,"Mercado Extra","89,90",\n05/11/2026,Pix recebido,,"2.500,00"\n';
    const t = parseCsv(text);
    const mapping = guessCsvMapping(t)!;
    expect(mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
    const { rows } = csvToStatement(t, mapping, 2);
    expect(rows.map((r) => r.amountMinor)).toEqual([-8990n, 250000n]);
  });

  it("linhas iguais no mesmo dia ficam com referências diferentes; o mesmo ficheiro dá as mesmas referências", () => {
    const text = "Data;Descrição;Valor\n01/11/2026;Café;-1,20\n01/11/2026;Café;-1,20\n";
    const t = parseCsv(text);
    const a = csvToStatement(t, guessCsvMapping(t)!, 2).rows.map((r) => r.ref);
    const b = csvToStatement(parseCsv(text), guessCsvMapping(t)!, 2).rows.map((r) => r.ref);
    expect(new Set(a).size).toBe(2);
    expect(a).toEqual(b);
  });

  it("sem coluna de data reconhecível não adivinha", () => {
    expect(guessCsvMapping(parseCsv("a;b\nx;y\n"))).toBeNull();
  });
});

describe("OFX", () => {
  it("lê transações SGML com FITID, sinal e descrição", () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261121120000[-3:BRT]<TRNAMT>-45.90<FITID>A1<NAME>COMPRA MERCADO<MEMO>Cartão</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261122<TRNAMT>1200.00<FITID>A2<MEMO>SALARIO</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>xx<TRNAMT>1<FITID>A3<NAME>Lixo</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(looksLikeOfx(ofx)).toBe(true);
    expect(looksLikeOfx("Data;Valor")).toBe(false);
    const { rows, invalid } = ofxToStatement(ofx, 2);
    expect(rows).toEqual([
      { occurredOn: "2026-11-21", description: "COMPRA MERCADO · Cartão", amountMinor: -4590n, ref: "ofx:A1" },
      { occurredOn: "2026-11-22", description: "SALARIO", amountMinor: 120000n, ref: "ofx:A2" },
    ]);
    expect(invalid).toEqual([3]);
  });
});
