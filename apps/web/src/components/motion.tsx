"use client";

import { useEffect, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Anel da nota de saúde financeira (0–100), que se preenche ao aparecer. */
export function ScoreRing({ score, label, sublabel, tone }: { score: number; label: string; sublabel: string; tone: "excellent" | "good" | "attention" | "critical" }) {
  const [shown, setShown] = useState(0);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduced()) {
      setShown(score);
      setValue(score);
      return;
    }
    const id = requestAnimationFrame(() => setShown(score));
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1200);
      setValue(Math.round(score * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(raf);
    };
  }, [score]);
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = { excellent: "var(--color-success)", good: "var(--color-brand)", attention: "var(--color-warning)", critical: "var(--color-danger)" }[tone];
  return (
    <div className="relative grid size-40 shrink-0 place-items-center" role="img" aria-label={`${label}: ${score} ${sublabel}`}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-graphite)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          style={{ transition: "stroke-dashoffset 1200ms cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 10px ${color})` }}
        />
      </svg>
      <div className="flex flex-col items-center" aria-hidden>
        <span className="tabular font-heading text-4xl font-extrabold">{value}</span>
        <span className="text-xs text-subtle">{sublabel}</span>
      </div>
    </div>
  );
}
