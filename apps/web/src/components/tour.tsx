"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clientCookie, TOUR_COOKIE } from "@/lib/appearance";
import { cx } from "@/components/ui";

export const TOUR_EVENT = "anen:tour";

export interface TourStep {
  /** Valores de data-tour procurados por ordem; vale o primeiro visível (ex.: botão do computador ou do telemóvel). */
  targets: string[];
  title: string;
  body: string;
}

export interface TourLabels {
  next: string;
  back: string;
  skip: string;
  done: string;
  stepOf: string;
  welcomeTitle: string;
  welcomeBody: string;
  start: string;
  later: string;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

function pageZoom(): number {
  const z = parseFloat(getComputedStyle(document.body).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

function findTarget(step: TourStep): HTMLElement | null {
  for (const name of step.targets) {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(visible);
    if (el) return el;
  }
  return null;
}

/**
 * Tour de boas-vindas: na 1ª vez no painel (sem o cookie anen-tour) pergunta se a pessoa quer conhecer a ANEN
 * e destaca, uma a uma, as partes principais. "Pular" ou terminar grava o cookie (não volta a aparecer);
 * em Definições → Aparência dá para ver de novo (/painel?tour=1).
 */
export function Tour({ steps, labels, autoStart }: { steps: TourStep[]; labels: TourLabels; autoStart: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [phase, setPhase] = useState<"off" | "welcome" | "steps">("off");
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState<TourStep[]>([]);

  const finish = useCallback(() => {
    document.cookie = clientCookie(TOUR_COOKIE, "done");
    setPhase("off");
    setBox(null);
    if (search.get("tour")) router.replace(pathname);
  }, [pathname, router, search]);

  // Começa sozinho na 1ª visita ao painel, ou quando pedido em Definições (?tour=1).
  useEffect(() => {
    if (pathname !== "/painel") return;
    // Em navegador automatizado (testes E2E) não começa sozinho, para não tapar os cliques; ?tour=1 abre sempre.
    if ((autoStart && !navigator.webdriver) || search.get("tour") === "1") {
      const id = setTimeout(() => setPhase("welcome"), 900); // deixa as animações do painel acabarem
      return () => clearTimeout(id);
    }
  }, [autoStart, pathname, search]);

  useEffect(() => {
    const start = () => setPhase("welcome");
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, []);

  const begin = () => {
    const list = steps.filter((s) => findTarget(s));
    setAvailable(list);
    setIndex(0);
    if (list.length === 0) return finish();
    setPhase("steps");
  };

  const measure = useCallback(() => {
    const step = available[index];
    const el = step ? findTarget(step) : null;
    if (!el) return setBox(null);
    // Com "letra grande" o <body> está ampliado (zoom): as medidas vêm em pixels do ecrã e as posições
    // dentro do body são multiplicadas pelo zoom, por isso divide-se.
    const z = pageZoom();
    const r = el.getBoundingClientRect();
    const pad = 8;
    setBox({ top: r.top / z - pad, left: r.left / z - pad, width: r.width / z + pad * 2, height: r.height / z + pad * 2 });
  }, [available, index]);

  useLayoutEffect(() => {
    if (phase !== "steps") return;
    const el = available[index] ? findTarget(available[index]!) : null;
    if (el) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
    measure();
    const id = setTimeout(measure, 420); // depois do scroll suave
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    nextBtn.current?.focus();
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [phase, index, available, measure]);

  useEffect(() => {
    if (phase === "off") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (phase === "steps" && e.key === "ArrowRight") setIndex((i) => Math.min(available.length - 1, i + 1));
      if (phase === "steps" && e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, available.length, finish]);

  if (phase === "off") return null;

  if (phase === "welcome") {
    return (
      <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tour-welcome">
        <div className="tour-pop flex w-full max-w-md flex-col gap-4 rounded-3xl border border-line bg-surface p-6 text-paper sm:p-7">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand text-2xl font-extrabold text-on-brand" aria-hidden>A</span>
          <h2 id="tour-welcome" className="text-2xl font-extrabold leading-tight">{labels.welcomeTitle}</h2>
          <p className="text-[15px] leading-relaxed text-muted">{labels.welcomeBody}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="button" autoFocus onClick={begin} className="h-12 flex-1 rounded-xl bg-brand px-5 text-base font-semibold text-on-brand transition-transform active:scale-[0.97]">
              {labels.start}
            </button>
            <button type="button" onClick={finish} className="h-12 rounded-xl border border-line px-5 text-base text-muted hover:text-paper">
              {labels.later}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const step = available[index];
  if (!step) return null;
  const last = index === available.length - 1;
  // Cartão por baixo do destaque; se não couber, por cima.
  const vh = typeof window !== "undefined" ? window.innerHeight / pageZoom() : 800;
  const below = !box || box.top + box.height + 240 < vh;
  const cardStyle: React.CSSProperties = box
    ? below
      ? { top: Math.min(box.top + box.height + 14, vh - 220) }
      : { bottom: Math.max(12, vh - box.top + 14) }
    : { top: "40%" };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* fundo escuro com um "buraco" no elemento em destaque */}
      {box ? (
        <div
          className="tour-spot pointer-events-none fixed rounded-2xl ring-2 ring-brand"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.68)" }}
          aria-hidden
        />
      ) : (
        <div className="fixed inset-0 bg-black/70" aria-hidden />
      )}
      {/* bloqueia cliques na página por baixo; tocar fora NÃO fecha (evita sair sem querer) */}
      <div className="fixed inset-0" aria-hidden />
      <div
        key={index}
        className="tour-pop fixed inset-x-3 mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-surface p-5 text-paper shadow-2xl sm:inset-x-0"
        style={cardStyle}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
          {labels.stepOf.replace("{current}", String(index + 1)).replace("{total}", String(available.length))}
        </span>
        <h2 id="tour-title" className="text-xl font-bold leading-tight">{step.title}</h2>
        <p className="text-[15px] leading-relaxed text-muted">{step.body}</p>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={finish} className="h-11 rounded-lg px-3 text-sm text-subtle hover:text-paper">
            {labels.skip}
          </button>
          <span className="flex-1" />
          {index > 0 ? (
            <button type="button" onClick={() => setIndex(index - 1)} className="h-11 rounded-lg border border-line px-4 text-[15px] text-muted hover:text-paper">
              {labels.back}
            </button>
          ) : null}
          <button
            ref={nextBtn}
            type="button"
            onClick={() => (last ? finish() : setIndex(index + 1))}
            className={cx("h-11 rounded-lg bg-brand px-5 text-[15px] font-semibold text-on-brand transition-transform active:scale-[0.97]")}
          >
            {last ? labels.done : labels.next}
          </button>
        </div>
        <div className="flex justify-center gap-1.5 pt-1" aria-hidden>
          {available.map((_, i) => (
            <span key={i} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-6 bg-brand" : "w-1.5 bg-graphite-soft")} />
          ))}
        </div>
      </div>
    </div>
  );
}
