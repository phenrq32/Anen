"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  /** Contador (ex.: notificações por ler) e o seu texto para leitores de ecrã. */
  badge?: { count: number; label: string };
  icon: "receipt" | "bulb" | "spark" | "bell" | "report" | "grid" | "building" | "users" | "shield" | "settings" | "wallet" | "file" | "chef" | "briefcase" | "contacts" | "chart" | "cart" | "box";
}

const icons: Record<NavItem["icon"], React.ReactNode> = {
  briefcase: <path d="M2.5 7h15v9.5h-15zM7 7V4.5h6V7M2.5 11h15M9 11v1.5h2V11" />,
  contacts: <path d="M4 2.5h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4zM4 6H2.5M4 10H2.5M4 14H2.5M10 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 14c.4-1.8 1.6-3 3-3s2.6 1.2 3 3" />,
  grid: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
  file: <path d="M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M8 10h5M8 13h5" />,
  chart: <path d="M3 16.5h14M5 13l3.5-4 3 2.5L16 6M13 6h3v3" />,
  receipt: <path d="M5 2.5h10v15l-2-1.3-1.7 1.3-1.3-1.3-1.3 1.3L7 16.2 5 17.5zM8 6.5h4M8 9.5h4M8 12.5h2.5" />,
  bulb: <path d="M10 2.5a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 15.5h4M8.5 17.5h3" />,
  spark: <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  bell: <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 2 6H3c.5-.5 2-2 2-6zM8.5 16.5a1.5 1.5 0 0 0 3 0" />,
  report: <path d="M4 2.5h12v15H4zM7 13.5v-3M10 13.5v-6M13 13.5V9" />,
  cart: <path d="M2 3h2.5l2 9.5h9l1.5-7H5.5M8 16.5h.01M15 16.5h.01" />,
  box: <path d="M10 2.5l7 3.5v8l-7 3.5-7-3.5V6zM3 6l7 3.5L17 6M10 9.5v8" />,
  chef: <path d="M6 11.5V16.5h8v-5M6 11.5a3 3 0 0 1-.5-5.9A4.5 4.5 0 0 1 14.5 5.6a3 3 0 0 1-.5 5.9zM6 14h8" />,
  wallet:<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H15v3M3 6.5V15a2 2 0 0 0 2 2h11a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 6.5zM13.5 12h.01" />,
  building: <path d="M4 17V4h8v13M12 8h4v9M2 17h16M7 7h2M7 10h2M7 13h2" />,
  users: <path d="M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1.5 17c.5-3 2.7-5 5.5-5s5 2 5.5 5M13 3.5a3 3 0 0 1 0 5.5M15 12c2 .6 3.2 2.4 3.5 5" />,
  shield: <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3zM7 10l2 2 4-4" />,
  settings: <path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4" />,
};

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function NavIcon({ name, className }: { name: NavItem["icon"] | "plus" | "search" | "menu"; className?: string }) {
  const extra: Record<string, React.ReactNode> = {
    plus: <path d="M10 4v12M4 10h12" />,
    search: <path d="M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM14 14l4 4" />,
    menu: <path d="M3 5.5h14M3 10h14M3 14.5h14" />,
  };
  return (
    <svg viewBox="0 0 20 20" className={cx("size-[18px] shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {extra[name] ?? icons[name as NavItem["icon"]]}
    </svg>
  );
}

/** O item ativo é o que tem o prefixo mais longo coincidente com o caminho atual. */
export function activeHref(pathname: string, items: NavItem[]): string | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function Badge({ badge }: { badge: NavItem["badge"] }) {
  if (!badge || badge.count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-on-brand" aria-label={badge.label}>
      {badge.count > 99 ? "99+" : badge.count}
    </span>
  );
}

/** Navegação agrupada (Dia a dia, Negócio, Análise, Conta). `onNavigate` fecha a gaveta no telemóvel. */
export function NavGroups({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname, groups.flatMap((g) => g.items));
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{group.label}</span>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isActive = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    data-tour={item.href === "/definicoes" ? "settings" : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={cx(
                      "nav-item group relative flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-all duration-200",
                      isActive ? "bg-brand/10 font-medium text-paper" : "text-muted hover:bg-graphite/70 hover:text-paper",
                    )}
                  >
                    {isActive ? <span className="nav-indicator absolute inset-y-2 left-0 w-1 rounded-full bg-brand" aria-hidden /> : null}
                    <span
                      className={cx(
                        "grid size-8 place-items-center rounded-md transition-all duration-200",
                        isActive ? "bg-brand text-on-brand" : "bg-graphite/60 text-muted group-hover:scale-110 group-hover:text-brand",
                      )}
                    >
                      <NavIcon name={item.icon} className="size-[17px]" />
                    </span>
                    <span className="truncate">{item.label}</span>
                    <Badge badge={item.badge} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
