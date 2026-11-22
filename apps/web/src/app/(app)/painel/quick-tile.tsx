"use client";

import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/nav-links";
import { QUICK_ADD_EVENT } from "@/components/mobile-tabbar";

/**
 * Atalho "Registar movimento" do painel: abre o registo rápido. Se ele não existir (ainda sem contas),
 * leva a criar a primeira conta, para o botão nunca ficar sem ação.
 */
export function QuickAddTile({ label, hint, fallbackHref }: { label: string; hint: string; fallbackHref: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        const opened = !window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { cancelable: true }));
        if (!opened) router.push(fallbackHref);
      }}
      className="lift group flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-4 text-left"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-brand text-ink transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110">
        <NavIcon name="plus" className="size-5" />
      </span>
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold">{label}</span>
        <span className="text-xs text-subtle">{hint}</span>
      </span>
    </button>
  );
}
