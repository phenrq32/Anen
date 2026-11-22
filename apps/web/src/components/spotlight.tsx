"use client";

import { useEffect } from "react";

/**
 * Holofote dos cartões (.spot): guarda a posição do ponteiro em --mx/--my do cartão por baixo dele.
 * Um só ouvinte para a página toda; não faz nada com "reduzir animações" nem em ecrãs de toque.
 */
export function Spotlight() {
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const html = document.documentElement;
        if (html.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const el = (e.target as Element | null)?.closest?.(".spot") as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Com "texto grande" o <body> tem zoom: as medidas vêm em pixels do ecrã e o CSS dentro do body é ampliado.
        const z = parseFloat(getComputedStyle(document.body).zoom || "1") || 1;
        el.style.setProperty("--mx", `${(e.clientX - r.left) / z}px`);
        el.style.setProperty("--my", `${(e.clientY - r.top) / z}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
