import type { PurchaseStatus } from "@anen/types";

export const statusTone = (s: PurchaseStatus): "brand" | "danger" | "neutral" =>
  s === "received" ? "brand" : s === "cancelled" ? "danger" : "neutral";
