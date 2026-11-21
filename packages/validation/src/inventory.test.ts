import { describe, expect, it } from "vitest";
import { purchaseLineSchema, receivePurchaseSchema, stockItemSchema, stockMovementSchema } from "./inventory";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("validação do inventário e das compras", () => {
  it("artigo: quantidades com vírgula, mínimo vazio = 0, unidade obrigatória", () => {
    const ok = stockItemSchema.parse({ name: " Farinha ", unit: "kg", currencyCode: "EUR", minQuantity: "2,5", targetQuantity: "" });
    expect(ok).toMatchObject({ name: "Farinha", minQuantity: "2.5", targetQuantity: null, preferredSupplierId: null });
    expect(stockItemSchema.parse({ name: "x", unit: "un", currencyCode: "EUR" }).minQuantity).toBe("0");
    expect(stockItemSchema.parse({ name: "x", unit: " ", currencyCode: "EUR" }).unit).toBeNull();
    expect(stockItemSchema.safeParse({ name: "x", unit: "kg", currencyCode: "EUR", minQuantity: "1,2345" }).success).toBe(false);
  });

  it("movimento: entrada exige custo; contagem aceita zero; saída não", () => {
    const base = { itemId: uuid, occurredOn: "2026-11-21" };
    expect(stockMovementSchema.safeParse({ ...base, kind: "in", quantity: "3" }).error?.issues[0]?.message).toBe("amount_invalid");
    expect(stockMovementSchema.parse({ ...base, kind: "in", quantity: "3,5", unitCost: "1,20" }).quantity).toBe("3.5");
    expect(stockMovementSchema.parse({ ...base, kind: "count", quantity: "0" }).quantity).toBe("0");
    expect(stockMovementSchema.safeParse({ ...base, kind: "out", quantity: "0" }).error?.issues[0]?.message).toBe("quantity_invalid");
    expect(stockMovementSchema.safeParse({ ...base, kind: "out", quantity: "-1" }).success).toBe(false);
  });

  it("linha de encomenda e receção", () => {
    expect(purchaseLineSchema.parse({ orderId: uuid, quantity: "25", unitPrice: "0,95" })).toMatchObject({ quantity: "25", description: null, stockItemId: null });
    expect(purchaseLineSchema.safeParse({ orderId: uuid, quantity: "0", unitPrice: "1" }).success).toBe(false);
    expect(receivePurchaseSchema.parse({ orderId: uuid, receivedOn: "2026-11-21", accountId: "", paid: "1" })).toEqual({
      orderId: uuid,
      receivedOn: "2026-11-21",
      accountId: null,
      paid: true,
    });
    expect(receivePurchaseSchema.parse({ orderId: uuid, receivedOn: "2026-11-21" }).paid).toBe(false);
  });
});
