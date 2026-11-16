import Link from "next/link";
import type { Messages } from "@anen/i18n";
import { AutoSubmitSelect } from "@/components/forms";
import { Logo } from "@/components/ui";
import { switchContextAction } from "@/app/(app)/actions";
import type { SessionContext } from "@/lib/session";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { roleName } from "@/lib/errors";

export function AppShell({
  m,
  session,
  children,
  overlay,
}: {
  m: Messages;
  session: SessionContext;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const items: NavItem[] = [
    { href: "/painel", label: m.nav.dashboard, icon: "grid" },
    { href: "/financas", label: m.nav.finance, icon: "wallet" },
    { href: "/orcamentos", label: m.nav.quotes, icon: "file" },
    { href: "/restauracao", label: m.nav.recipes, icon: "chef" },
    { href: "/projetos", label: m.nav.projects, icon: "briefcase" },
    { href: "/contactos", label: m.nav.contacts, icon: "contacts" },
  ];
  if (session.active) {
    items.push(
      { href: "/organizacao", label: m.nav.organization, icon: "building" },
      { href: "/organizacao/membros", label: m.nav.members, icon: "users" },
      { href: "/organizacao/funcoes", label: m.nav.roles, icon: "shield" },
    );
  }
  items.push({ href: "/definicoes", label: m.nav.settings, icon: "settings" });

  const contextOptions = [
    { value: "personal", label: m.nav.personalContext },
    ...session.memberships.map((x) => ({ value: x.organization.id, label: x.organization.name })),
  ];
  const displayName = session.profile.full_name ?? session.user.email;

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/painel" className="px-2 pt-2" aria-label="ANEN">
        <Logo className="h-6 w-auto" />
      </Link>
      <form action={switchContextAction} className="flex flex-col gap-1.5">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">{m.nav.switchContext}</span>
        <AutoSubmitSelect
          name="context"
          label={m.nav.switchContext}
          defaultValue={session.active?.organization.id ?? "personal"}
          options={contextOptions}
          submitLabel={m.common.continue}
        />
        {session.active ? (
          <span className="px-1 text-xs text-subtle">{roleName(m, session.active.role)}</span>
        ) : null}
      </form>
      <nav aria-label={m.nav.mainNavigation} className="flex-1">
        <NavLinks items={items} />
        <Link
          href="/organizacoes/nova"
          className="mt-4 flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors hover:bg-graphite hover:text-paper"
        >
          <span className="grid size-5 place-items-center text-brand" aria-hidden>
            +
          </span>
          {m.nav.newOrganization}
        </Link>
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-subtle">{session.user.email}</p>
        </div>
        <form action="/auth/sair" method="post">
          <button type="submit" className="h-9 rounded-md px-2.5 text-xs text-muted hover:bg-graphite hover:text-paper">
            {m.common.signOut}
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-ink lg:block">{sidebar}</aside>
      <details className="group border-b border-line bg-ink lg:hidden">
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
          <Logo className="h-5 w-auto" />
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className="max-w-40 truncate">{session.active?.organization.name ?? m.nav.personalContext}</span>
            <svg viewBox="0 0 20 20" className="size-5 transition-transform group-open:rotate-180" aria-label={m.nav.openMenu}>
              <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
        </summary>
        <div className="border-t border-line">{sidebar}</div>
      </details>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-28 pt-8 sm:px-8 sm:pt-10">{children}</main>
      {overlay}
    </div>
  );
}
