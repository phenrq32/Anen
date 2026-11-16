import type { QuoteStatus } from "@anen/types";

export function statusTone(status: QuoteStatus): "neutral" | "brand" | "danger" {
  return status === "accepted" ? "brand" : status === "rejected" || status === "cancelled" ? "danger" : "neutral";
}
