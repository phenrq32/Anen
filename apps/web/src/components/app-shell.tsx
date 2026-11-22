import Link from "next/link";
import { Suspense } from "react";
import { format, type Messages } from "@anen/i18n";
import { AutoSubmitSelect } from "@/components/forms";
import { Logo } from "@/components/ui";
import { switchContextAction } from "@/app/(app)/actions";
import type { SessionContext } from "@/lib/session";
import { NavGroups, type NavGroup, type NavItem } from "@/components/nav-links";
import { CommandPalette, SearchButton, type PaletteAction } from "@/components/command-palette";
import { MobileTabBar, QUICK_ADD_EVENT } from "@/components/mobile-tabbar";
import { NavProgress } from "@/components/nav-progress";
import { Spotlight } from "@/components/spotlight";
import { Tour, type TourStep } from "@/components/tour";
import { roleName } from "@/lib/errors";
import { isHiddenHref, parseHiddenModules } from "@/lib/modules";

export function AppShell({
  m,
  session,
  children,
  overlay,
  unread = 0,
  canQuickAdd = false,
  showTour = false,
}: {
  m: Messages;
  session: SessionContext;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  /** Notificações por ler (todas as organizações e o pessoal). */
  unread?: number;
  /** Há contas e permissão: o botão "Registar" abre o registo rápido. */
  canQuickAdd?: boolean;
  /** Tour de boas-vindas ainda não visto neste aparelho (cookie anen-tour). */
  showTour?: boolean;
}) {
  const unreadLabel = format(m.notifications.unreadCount, { count: unread });
  const n = m.nav;
  const item = (href: string, label: string, icon: NavItem["icon"], badge?: NavItem["badge"]): NavItem => ({ href, label, icon, ...(badge ? { badge } : {}) });
  const notifications = item("/notificacoes", n.notifications, "bell", { count: unread, label: unreadLabel });

  const allGroups: NavGroup[] = [
    {
      label: n.groups.daily,
      items: [item("/painel", n.dashboard, "grid"), item("/financas", n.finance, "wallet"), notifications, item("/contactos", n.contacts, "contacts")],
    },
    {
      label: n.groups.business,
      items: [
        item("/orcamentos", n.quotes, "file"),
        item("/faturacao", n.invoicing, "receipt"),
        item("/projetos", n.projects, "briefcase"),
        item("/compras", n.purchases, "cart"),
        item("/inventario", n.inventory, "box"),
        item("/restauracao", n.recipes, "chef"),
      ],
    },
    {
      label: n.groups.insights,
      items: [item("/ia", n.ai, "spark"), item("/inteligencia", n.intelligence, "bulb"), item("/relatorios", n.reports, "report"), item("/mercado", n.market, "chart")],
    },
    {
      label: n.groups.account,
      items: [
        ...(session.active
          ? [item("/organizacao", n.organization, "building"), item("/organizacao/membros", n.members, "users"), item("/organizacao/funcoes", n.roles, "shield")]
          : []),
        item("/definicoes", n.settings, "settings"),
      ],
    },
  ];

  // Áreas que a pessoa escondeu (Definições → Áreas do menu) saem do menu, da barra e da procura.
  const hidden = parseHiddenModules(session.preferences.hidden_modules);
  const groups = allGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => !isHiddenHref(it.href, hidden)) }))
    .filter((g) => g.items.length > 0);

  const actions: PaletteAction[] = [
    ...(canQuickAdd ? [{ id: "quick-add", label: m.dashboard.quick.register, hint: m.dashboard.quick.registerHint, icon: "plus" as const, event: QUICK_ADD_EVENT }] : []),
    ...(!hidden.has("orcamentos") ? [{ id: "new-quote", label: m.dashboard.quick.quote, hint: m.dashboard.quick.quoteHint, icon: "file" as const, href: "/orcamentos/novo" }] : []),
    ...(!hidden.has("ia") ? [{ id: "ask", label: m.dashboard.quick.ask, hint: m.dashboard.quick.askHint, icon: "spark" as const, href: "/ia" }] : []),
    { id: "new-org", label: n.newOrganization, icon: "building", href: "/organizacoes/nova" },
    { id: "appearance", label: n.appearance, icon: "settings", href: "/definicoes#aparencia" },
    { id: "a11y", label: m.settings.a11y.title, icon: "settings", href: "/definicoes#acessibilidade" },
    { id: "modules", label: m.settings.modules.title, icon: "settings", href: "/definicoes#areas" },
  ];

  const ts = m.tour.steps;
  const tourSteps: TourStep[] = [
    { targets: ["health"], ...ts.health },
    { targets: ["quick"], ...ts.quick },
    { targets: ["register"], ...ts.register },
    { targets: ["search"], ...ts.search },
    { targets: ["more"], ...ts.more },
    { targets: ["today"], ...ts.today },
    { targets: ["settings"], ...ts.settings },
  ];

  const contextOptions = [
    { value: "personal", label: n.personalContext },
    ...session.memberships.map((x) => ({ value: x.organization.id, label: x.organization.name })),
  ];
  const displayName = session.profile.full_name ?? session.user.email;
  const initials = (session.profile.full_name ?? session.user.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  const contextSwitcher = (
    <form action={switchContextAction} className="flex flex-col gap-1.5">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{n.switchContext}</span>
      <AutoSubmitSelect
        name="context"
        label={n.switchContext}
        defaultValue={session.active?.organization.id ?? "personal"}
        options={contextOptions}
        submitLabel={m.common.continue}
      />
      {session.active ? <span className="px-1 text-xs text-subtle">{roleName(m, session.active.role)}</span> : null}
    </form>
  );

  const userRow = (
    <div className="flex shrink-0 items-center gap-3 border-t border-line px-1 pt-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-[#ff5a1b] text-sm font-bold text-on-brand" aria-hidden>
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-subtle">{session.user.email}</p>
      </div>
      <form action="/auth/sair" method="post">
        <button type="submit" className="h-10 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-graphite hover:text-paper">
          {m.common.signOut}
        </button>
      </form>
    </div>
  );

  const paletteLabels = {
    search: n.search,
    placeholder: n.searchPlaceholder,
    shortcut: n.searchShortcut,
    noResults: n.noResults,
    pages: n.pagesGroup,
    actions: n.actionsGroup,
  };

  return (
    <div className="app-bg min-h-dvh lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <Suspense fallback={null}>
        <NavProgress />
        <Spotlight />
      </Suspense>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-ink/80 backdrop-blur-xl lg:block">
        <div className="flex h-full flex-col gap-5 p-4">
          <Link href="/painel" className="px-2 pt-2" aria-label="ANEN">
            <Logo className="h-6 w-auto" />
          </Link>
          <SearchButton label={n.search} shortcut={n.searchShortcut} />
          {contextSwitcher}
          {/* A navegação desliza quando não cabe no ecrã; o utilizador e "Terminar sessão" ficam sempre visíveis. */}
          <nav aria-label={n.mainNavigation} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            <NavGroups groups={groups} />
            <Link
              href="/organizacoes/nova"
              className="mt-4 flex h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-graphite hover:text-paper"
            >
              <span className="grid size-8 place-items-center rounded-md border border-dashed border-line text-brand" aria-hidden>
                +
              </span>
              {n.newOrganization}
            </Link>
          </nav>
          {userRow}
        </div>
      </aside>

      {/* Topo do telemóvel: logótipo, contexto e procura. A navegação está na barra inferior. */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-ink/85 px-4 backdrop-blur-xl lg:hidden">
        <Link href="/painel" aria-label="ANEN">
          <Logo className="h-5 w-auto" />
        </Link>
        <span className="max-w-[45vw] truncate text-sm text-muted">{session.active?.organization.name ?? n.personalContext}</span>
      </header>

      <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-8 px-4 pb-32 pt-6 sm:px-8 sm:pt-10 lg:pb-28">{children}</main>

      <MobileTabBar
        tabs={[
          item("/painel", n.dashboard, "grid"),
          item("/financas", n.finance, "wallet"),
          hidden.has("ia") ? notifications : item("/ia", n.ai, "spark"),
        ]}
        groups={groups}
        canQuickAdd={canQuickAdd}
        labels={{ more: n.more, register: n.register, menuTitle: n.menuTitle, search: n.search, close: m.common.close }}
        header={
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-ink/60 p-4">
            {contextSwitcher}
            {userRow}
          </div>
        }
      />
      <CommandPalette groups={groups} actions={actions} labels={paletteLabels} />
      <Suspense fallback={null}>
        <Tour
          steps={tourSteps}
          autoStart={showTour}
          labels={{
            next: m.tour.next,
            back: m.tour.back,
            skip: m.tour.skip,
            done: m.tour.done,
            stepOf: m.tour.stepOf,
            welcomeTitle: m.tour.welcomeTitle,
            welcomeBody: m.tour.welcomeBody,
            start: m.tour.start,
            later: m.tour.later,
          }}
        />
      </Suspense>
      {overlay}
    </div>
  );
}
