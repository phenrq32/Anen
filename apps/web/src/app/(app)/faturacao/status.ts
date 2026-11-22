import type { FiscalDocumentStatus } from "@anen/types";

export const statusTone = (s: FiscalDocumentStatus): "brand" | "danger" | "neutral" =>
  s === "final" || s === "settled" ? "brand" : s === "canceled" ? "danger" : "neutral";
