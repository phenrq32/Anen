import { AppShell } from "@/components/app-shell";
import { ConfigMissing } from "@/components/config-missing";
import { QuickAdd } from "@/components/quick-add";
import { buildCategoryMemory } from "@/lib/category-memory";
import { getPublicEnv } from "@/lib/env";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import { cookies } from "next/headers";
import { TOUR_COOKIE } from "@/lib/appearance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { WorkspaceKeyProvider, WorkspaceSync } from "@/components/workspace-context";
import { BUSINESS_MODULES, contextHiddenModules } from "@/lib/modules";
import { workspaceKey } from "@/lib/workspace";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  const session = await requireOnboardedSession();
  const scope = financeScope(session);

  // Tudo em paralelo: contas e categorias do registo rápido e o contador de notificações
  // (count com o índice parcial notifications_unread_idx; o RLS já filtra por pessoa e permissão).
  const [accounts, categories, unreadRes, memoryRows] = await Promise.all([
    scope.canWrite
      ? session.supabase.from("financial_accounts").select("id, name, currency_code").eq(scope.column, scope.value).is("archived_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; currency_code: string }[] }),
    scope.canWrite
      ? session.supabase
          .from("transaction_categories")
          .select("id, key, name, kind, is_system")
          .or(`is_system.eq.true,${scope.column}.eq.${scope.value}`)
          .is("archived_at", null)
          .order("name")
      : Promise.resolve({ data: [] as { id: string; key: string | null; name: string; kind: "income" | "expense"; is_system: boolean }[] }),
    session.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).is("dismissed_at", null),
    // Memória de categorias do registo rápido: os últimos movimentos com categoria.
    scope.canWrite
      ? session.supabase
          .from("transactions")
          .select("description, kind, category_id")
          .eq(scope.column, scope.value)
          .not("category_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(400)
      : Promise.resolve({ data: [] as { description: string; kind: "income" | "expense"; category_id: string | null }[] }),
  ]);
  const unread = unreadRes.count;

  // Menu por workspace (Fase 4): no pessoal saem os módulos de empresa que a pessoa não usa com dados pessoais;
  // numa organização, as áreas sem permissão de leitura.
  const usageTables: Record<(typeof BUSINESS_MODULES)[number], "quotes" | "fiscal_documents" | "projects" | "purchase_orders" | "stock_items" | "recipes" | "market_watches"> = {
    orcamentos: "quotes",
    faturacao: "fiscal_documents",
    projetos: "projects",
    compras: "purchase_orders",
    inventario: "stock_items",
    restauracao: "recipes",
    mercado: "market_watches",
  };
  const [usage, invitationsRes] = await Promise.all([
    session.active
      ? Promise.resolve(new Set<string>())
      : Promise.all(
          BUSINESS_MODULES.map(async (k) => {
            const { count } = await session.supabase.from(usageTables[k]).select("id", { count: "exact", head: true }).eq("owner_user_id", session.user.id);
            return (count ?? 0) > 0 ? k : null;
          }),
        ).then((ks) => new Set<string>(ks.flatMap((k) => (k ? [k] : [])))),
    session.supabase.rpc("my_invitations"),
  ]);
  const contextHidden = session.active
    ? contextHiddenModules({ type: "BUSINESS", permissions: session.active.permissions })
    : contextHiddenModules({ type: "PERSONAL", personalUsage: usage });
  const overlay = scope.canWrite ? (
    <QuickAdd
      m={m}
      accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
      categories={(categories.data ?? []).map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
      today={todayIn(scope.timezone)}
      memory={buildCategoryMemory(memoryRows.data ?? [])}
    />
  ) : null;

  // Chave do workspace com que esta página foi desenhada: os formulários enviam-na e o servidor recusa
  // gravar se outra aba entretanto mudou o workspace ativo (QA-03).
  return (
    <WorkspaceKeyProvider value={workspaceKey(scope.workspace)}>
      <WorkspaceSync />
      {/* key: ao mudar de workspace, o estado dos componentes do navegador recomeça (sem restos do anterior). */}
      <AppShell
        key={workspaceKey(scope.workspace)}
        m={m}
        session={session}
        overlay={overlay}
        unread={unread ?? 0}
        canQuickAdd={scope.canWrite && (accounts.data ?? []).length > 0}
        showTour={(await cookies()).get(TOUR_COOKIE)?.value !== "done"}
        contextHidden={[...contextHidden]}
        invitations={(invitationsRes.data ?? []).map((i) => ({ id: i.id, organization: i.organization_name, roleKey: i.role_key, roleName: i.role_name }))}
      >
        {children}
      </AppShell>
    </WorkspaceKeyProvider>
  );
}
