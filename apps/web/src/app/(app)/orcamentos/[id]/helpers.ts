import { formatAmountInput } from "@anen/validation";

export { format, formatDate } from "@anen/i18n";

/** Valor em unidades mínimas → texto editável ("" para zero, para mostrar o placeholder). */
export function formatAmountInputSafe(minor: number, minorUnit: number): string {
  return minor === 0 ? "" : formatAmountInput(BigInt(minor), minorUnit);
}
