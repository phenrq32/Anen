"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { NavIcon, type NavGroup, type NavItem } from "@/components/nav-links";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: NavItem["icon"] | "plus";
  /** Navega para o endereço ou dispara um evento da aplicação (ex.: abrir o registo rápido). */
  href?: string;
  event?: string;
}

export interface PaletteLabels {
  search: string;
  placeholder: string;
  shortcut: string;
  noResults: string;
  pages: string;
  actions: string;
}

/** Evento global para abrir a procura (a barra do telemóvel e o botão do topo usam-no). */
export const OPEN_PALETTE_EVENT = "anen:open-palette";

const norm = (s: string) => s.toLocaleLowerCase("pt").normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Procura e comandos (Ctrl/⌘+K ou "/"): ir para qualquer área ou fazer uma ação sem procurar no menu.
 * Pesquisa sem acentos nem maiúsculas; setas e Enter para escolher.
 */
export function CommandPalette({ groups, actions, labels }: { groups: NavGroup[]; actions: PaletteAction[]; labels: PaletteLabels }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const open = useCallback(() => {
    setQuery("");
    setIndex(0);
    dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, open);
    };
  }, [open]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    const pages: PaletteAction[] = groups.flatMap((g) =>
      g.items.map((i) => ({ id: i.href, label: i.label, hint: g.label, icon: i.icon, href: i.href })),
    );
    const match = (a: PaletteAction) => !q || norm(`${a.label} ${a.hint ?? ""}`).includes(q);
    return { actions: actions.filter(match), pages: pages.filter(match) };
  }, [query, groups, actions]);
  const flat = [...results.actions, ...results.pages];

  const choose = (a: PaletteAction | undefined) => {
    if (!a) return;
    dialog.current?.close();
    if (a.event) window.dispatchEvent(new Event(a.event));
    else if (a.href) router.push(a.href);
  };

  const row = (a: PaletteAction, i: number) => (
    <li key={a.id} role="option" aria-selected={i === index} id={`palette-${i}`}>
      <button
        type="button"
        onMouseEnter={() => setIndex(i)}
        onClick={() => choose(a)}
        className={cx(
          "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition-colors",
          i === index ? "bg-brand/12 text-paper" : "text-muted",
        )}
      >
        <span className={cx("grid size-8 place-items-center rounded-md", i === index ? "bg-brand text-on-brand" : "bg-graphite")}>
          <NavIcon name={a.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{a.label}</span>
        {a.hint ? <span className="hidden text-xs text-subtle sm:block">{a.hint}</span> : null}
        {i === index ? <span className="text-xs text-subtle" aria-hidden>↵</span> : null}
      </button>
    </li>
  );

  return (
    <dialog
      ref={dialog}
      aria-label={labels.search}
      className="palette mx-auto mt-[10vh] w-[min(620px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-surface/95 p-0 text-paper backdrop:bg-black/60 backdrop:backdrop-blur-md"
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <NavIcon name="search" className="size-5 text-brand" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(flat.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(flat[index]);
            }
          }}
          placeholder={labels.placeholder}
          aria-label={labels.search}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={flat.length ? `palette-${index}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-paper placeholder:text-subtle focus:outline-none focus-visible:outline-none"
        />
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-subtle sm:block">Esc</kbd>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-2">
        {flat.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">{labels.noResults}</p>
        ) : (
          <ul id="palette-list" role="listbox" aria-label={labels.search} className="flex flex-col gap-0.5">
            {results.actions.length ? <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{labels.actions}</li> : null}
            {results.actions.map((a, i) => row(a, i))}
            {results.pages.length ? <li role="presentation" className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{labels.pages}</li> : null}
            {results.pages.map((a, i) => row(a, i + results.actions.length))}
          </ul>
        )}
      </div>
    </dialog>
  );
}

/** Botão "Procurar · Ctrl K" (abre a paleta). */
export function SearchButton({ label, shortcut, className }: { label: string; shortcut: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      data-tour="search"
      className={cx(
        "flex h-11 w-full items-center gap-3 rounded-lg border border-line bg-graphite/40 px-3 text-[15px] text-muted transition-all hover:border-brand/40 hover:text-paper",
        className,
      )}
    >
      <NavIcon name="search" className="size-4" />
      <span className="flex-1 text-left">{label}</span>
      <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-subtle">{shortcut}</kbd>
    </button>
  );
}
