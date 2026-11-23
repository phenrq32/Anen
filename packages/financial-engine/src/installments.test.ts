import { describe, expect, it } from "vitest";
import { dueDateIn, installmentProgress, installmentSchedule, MAX_INSTALLMENTS } from "./installments";

const ok = (r: ReturnType<typeof installmentSchedule>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("parcelas mensais com fim", () => {
  it("12 parcelas a partir do valor total, no dia 10", () => {
    const r = ok(installmentSchedule({ startOn: "2026-11-23", dueDay: 10, amount: { totalMinor: 120000n }, end: { count: 12 } }));
    expect(r.installments).toHaveLength(12);
    // O dia 10 de novembro já passou: começa em dezembro.
    expect(r.installments[0]).toEqual({ number: 1, dueOn: "2026-12-10", amountMinor: 10000n });
    expect(r.installments[11]).toEqual({ number: 12, dueOn: "2027-11-10", amountMinor: 10000n });
    expect(r.totalMinor).toBe(120000n);
  });

  it("se o dia ainda não passou, a primeira parcela é no próprio mês", () => {
    const r = ok(installmentSchedule({ startOn: "2026-11-05", dueDay: 10, amount: { perInstallmentMinor: 5000n }, end: { count: 2 } }));
    expect(r.installments.map((i) => i.dueOn)).toEqual(["2026-11-10", "2026-12-10"]);
  });

  it("dia 31: usa o último dia dos meses mais curtos, incluindo fevereiro e ano bissexto", () => {
    const r = ok(installmentSchedule({ startOn: "2027-12-01", dueDay: 31, amount: { perInstallmentMinor: 100n }, end: { count: 5 } }));
    expect(r.installments.map((i) => i.dueOn)).toEqual(["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
    expect(dueDateIn(2027, 2, 30)).toBe("2027-02-28");
  });

  it("os cêntimos que sobram vão para a última parcela e o total bate certo", () => {
    const r = ok(installmentSchedule({ startOn: "2026-01-01", dueDay: 1, amount: { totalMinor: 10000n }, end: { count: 3 } }));
    expect(r.installments.map((i) => i.amountMinor)).toEqual([3333n, 3333n, 3334n]);
    expect(r.totalMinor).toBe(10000n);
    const odd = ok(installmentSchedule({ startOn: "2026-01-01", dueDay: 15, amount: { totalMinor: 99999n }, end: { count: 7 } }));
    expect(odd.installments.reduce((a, i) => a + i.amountMinor, 0n)).toBe(99999n);
    expect(odd.installments.at(-1)!.amountMinor).toBe(99999n - 14285n * 6n);
  });

  it("fim por data: inclui a data de fim e nunca a ultrapassa", () => {
    const r = ok(installmentSchedule({ startOn: "2026-11-23", dueDay: 15, amount: { perInstallmentMinor: 2500n }, end: { endOn: "2027-06-15" } }));
    expect(r.installments.map((i) => i.dueOn)).toEqual(["2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15", "2027-04-15", "2027-05-15", "2027-06-15"]);
    const before = ok(installmentSchedule({ startOn: "2026-11-23", dueDay: 15, amount: { perInstallmentMinor: 2500n }, end: { endOn: "2027-06-14" } }));
    expect(before.installments.at(-1)!.dueOn).toBe("2027-05-15");
    expect(before.totalMinor).toBe(2500n * 6n);
  });

  it("valores grandes sem perder precisão (acima de 2^53 no total)", () => {
    const total = 9_007_199_254_740_993n;
    const r = ok(installmentSchedule({ startOn: "2026-01-01", dueDay: 1, amount: { totalMinor: total }, end: { count: 3 } }));
    expect(r.totalMinor).toBe(total);
  });

  it("recusa entradas inválidas", () => {
    const base = { startOn: "2026-01-01", dueDay: 10, amount: { totalMinor: 1000n } };
    expect(installmentSchedule({ ...base, end: { count: 0 } })).toEqual({ ok: false, error: "installment_count_invalid" });
    expect(installmentSchedule({ ...base, end: { count: MAX_INSTALLMENTS + 1 } })).toEqual({ ok: false, error: "installment_count_invalid" });
    expect(installmentSchedule({ ...base, end: { endOn: "2025-12-31" } })).toEqual({ ok: false, error: "installment_count_invalid" });
    expect(installmentSchedule({ ...base, dueDay: 0, end: { count: 2 } })).toEqual({ ok: false, error: "installment_day_invalid" });
    expect(installmentSchedule({ ...base, dueDay: 32, end: { count: 2 } })).toEqual({ ok: false, error: "installment_day_invalid" });
    expect(installmentSchedule({ ...base, startOn: "2026-02-30", end: { count: 2 } })).toEqual({ ok: false, error: "installment_date_invalid" });
    // 3 cêntimos não chegam para 4 parcelas de pelo menos 1 cêntimo
    expect(installmentSchedule({ ...base, amount: { totalMinor: 3n }, end: { count: 4 } })).toEqual({ ok: false, error: "installment_amount_invalid" });
    expect(installmentSchedule({ ...base, amount: { perInstallmentMinor: 0n }, end: { count: 4 } })).toEqual({ ok: false, error: "installment_amount_invalid" });
  });
});

describe("situação de um plano", () => {
  it("conta pagas, por pagar, canceladas e o valor em dívida (parcial conta como por pagar)", () => {
    const parcels = [
      { number: 1, amountMinor: 1000n, settledMinor: 1000n },
      { number: 2, amountMinor: 1000n, settledMinor: 400n },
      { number: 3, amountMinor: 1000n, settledMinor: 0n },
    ];
    expect(installmentProgress(parcels, 5)).toEqual({ paid: 1, remaining: 2, cancelled: 2, outstandingMinor: 1600n });
  });
});
