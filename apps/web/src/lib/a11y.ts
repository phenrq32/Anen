/**
 * Opções de acessibilidade (Definições → Acessibilidade), por aparelho, num só cookie ("motion,contrast,…").
 * O servidor aplica-as no <html> como data-*, por isso a página já chega certa, sem piscar.
 * Sem "server-only": o cliente usa a mesma lista para aplicar a mudança na hora.
 */
export const A11Y_OPTIONS = ["motion", "contrast", "links", "focus", "spacing", "font"] as const;
export type A11yOption = (typeof A11Y_OPTIONS)[number];
export const A11Y_COOKIE = "anen-a11y";

/** Atributo no <html> e o valor que liga a opção (ex.: data-motion="reduce"). */
export const A11Y_ATTR: Record<A11yOption, { attr: string; on: string }> = {
  motion: { attr: "motion", on: "reduce" },
  contrast: { attr: "contrast", on: "high" },
  links: { attr: "links", on: "underline" },
  focus: { attr: "focus", on: "strong" },
  spacing: { attr: "spacing", on: "wide" },
  font: { attr: "font", on: "readable" },
};

export function parseA11y(v: string | null | undefined): Set<A11yOption> {
  const parts = decodeURIComponent(v ?? "").split(",");
  return new Set(A11Y_OPTIONS.filter((o) => parts.includes(o)));
}

export function serializeA11y(set: Set<A11yOption>): string {
  return A11Y_OPTIONS.filter((o) => set.has(o)).join(",");
}

/** data-* para o <html> (só as opções ligadas). */
export function a11yDataAttributes(set: Set<A11yOption>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of set) out[`data-${A11Y_ATTR[o].attr}`] = A11Y_ATTR[o].on;
  return out;
}
