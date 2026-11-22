"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { OPEN_PALETTE_EVENT } from "@/components/command-palette";
import { activeHref, NavGroups, NavIcon, type NavGroup, type NavItem } from "@/components/nav-links";

export const QUICK_ADD_EVENT = "anen:quick-add";

/**
 * Barra inferior do telemóvel: 4 destinos principais e o botão central "Registar".
 * "Mais" abre uma gaveta com todas as áreas agrupadas. Alvos de toque de 56 px.
 */
export function MobileTabBar({
  tabs,
  groups,
  labels,
  canQuickAdd,
  header,
}: {
  tabs: NavItem[];
  groups: NavGroup[];
  labels: { more: string; register: string; menuTitle: string; search: string; close: string };
  /** Sem contas não há registo rápido: o botão leva a criar a primeira conta. */
  canQuickAdd: boolean;
  header?: React.ReactNode;
}) {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const all = groups.flatMap((g) => g.items);
  const active = activeHref(pathname, all);
  const inTabs = tabs.some((t) => t.href === active);

  useEffect(() => {
    sheet.current?.close();
  }, [pathname]);

  const tab = (item: NavItem) => {
    const on = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={on ? "page" : undefined}
        className={cx("tab relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", on ? "text-brand" : "text-muted")}
      >
        <span className={cx("grid h-8 w-12 place-items-center rounded-full transition-all duration-300", on ? "bg-brand/15" : "")}>
          <NavIcon name={item.icon} className="size-5" />
        </span>
        {item.label}
        {item.badge && item.badge.count > 0 ? (
          <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-brand" role="img" aria-label={item.badge.label} />
        ) : null}
      </Link>
    );
  };

  return (
    <>
      <nav
        aria-label={labels.menuTitle}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-lg items-stretch px-1">
          {tabs.slice(0, 2).map(tab)}
          <div className="flex flex-1 items-center justify-center">
            {canQuickAdd ? (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(QUICK_ADD_EVENT))}
                data-tour="register"
                className="fab grid size-14 -translate-y-4 place-items-center rounded-full bg-brand text-on-brand"
                aria-label={labels.register}
              >
                <NavIcon name="plus" className="size-6" />
              </button>
            ) : (
              <Link href="/financas/contas" className="fab grid size-14 -translate-y-4 place-items-center rounded-full bg-brand text-on-brand" aria-label={labels.register}>
                <NavIcon name="plus" className="size-6" />
              </Link>
            )}
          </div>
          {tabs.slice(2, 3).map(tab)}
          <button
            type="button"
            onClick={() => sheet.current?.showModal()}
            data-tour="more"
            className={cx("flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", !inTabs && active ? "text-brand" : "text-muted")}
          >
            <span className={cx("grid h-8 w-12 place-items-center rounded-full", !inTabs && active ? "bg-brand/15" : "")}>
              <NavIcon name="menu" className="size-5" />
            </span>
            {labels.more}
          </button>
        </div>
      </nav>

      <dialog
        ref={sheet}
        aria-label={labels.menuTitle}
        className="sheet fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-0 text-paper backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === sheet.current) sheet.current?.close();
        }}
      >
        <div className="sticky top-0 z-10 flex flex-col gap-3 bg-surface px-4 pb-3 pt-3">
          <span className="mx-auto h-1.5 w-12 rounded-full bg-graphite-soft" aria-hidden />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{labels.menuTitle}</h2>
            <button type="button" onClick={() => sheet.current?.close()} className="h-10 rounded-lg px-3 text-sm text-muted hover:bg-graphite">
              {labels.close}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              sheet.current?.close();
              window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
            }}
            className="flex h-12 items-center gap-3 rounded-xl border border-line bg-graphite/40 px-4 text-[15px] text-muted"
          >
            <NavIcon name="search" className="size-4" />
            {labels.search}
          </button>
        </div>
        <div className="flex flex-col gap-6 px-3 pb-8">
          {header}
          <NavGroups groups={groups} onNavigate={() => sheet.current?.close()} />
        </div>
      </dialog>
    </>
  );
}
