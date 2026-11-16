"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function FinanceTabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Finanças">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.href === "/financas" ? pathname === "/financas" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex h-11 items-center px-3 text-sm transition-colors",
                  active ? "font-medium text-paper" : "text-muted hover:text-paper",
                )}
              >
                {item.label}
                {active ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
