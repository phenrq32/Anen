"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: "grid" | "building" | "users" | "shield" | "settings" | "wallet" | "file" | "chef" | "briefcase" | "contacts";
}

const icons: Record<NavItem["icon"], React.ReactNode> = {
  briefcase: <path d="M2.5 7h15v9.5h-15zM7 7V4.5h6V7M2.5 11h15M9 11v1.5h2V11" />,
  contacts: <path d="M4 2.5h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4zM4 6H2.5M4 10H2.5M4 14H2.5M10 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 14c.4-1.8 1.6-3 3-3s2.6 1.2 3 3" />,
  grid: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
  file: <path d="M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M8 10h5M8 13h5" />,
  chef: <path d="M6 11.5V16.5h8v-5M6 11.5a3 3 0 0 1-.5-5.9A4.5 4.5 0 0 1 14.5 5.6a3 3 0 0 1-.5 5.9zM6 14h8" />,
  wallet:<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H15v3M3 6.5V15a2 2 0 0 0 2 2h11a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 6.5zM13.5 12h.01" />,
  building: <path d="M4 17V4h8v13M12 8h4v9M2 17h16M7 7h2M7 10h2M7 13h2" />,
  users: <path d="M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1.5 17c.5-3 2.7-5 5.5-5s5 2 5.5 5M13 3.5a3 3 0 0 1 0 5.5M15 12c2 .6 3.2 2.4 3.5 5" />,
  shield: <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3zM7 10l2 2 4-4" />,
  settings: <path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4" />,
};

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // O item ativo é o que tem o prefixo mais longo coincidente com o caminho atual.
  const active = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cx(
                "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                isActive ? "bg-graphite font-medium text-paper" : "text-muted hover:bg-graphite/60 hover:text-paper",
              )}
            >
              {isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" aria-hidden /> : null}
              <svg viewBox="0 0 20 20" className={cx("size-[18px]", isActive ? "text-brand" : "")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {icons[item.icon]}
              </svg>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
