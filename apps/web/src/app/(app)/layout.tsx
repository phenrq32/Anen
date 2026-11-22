import { AppShell } from "@/components/app-shell";
import { ConfigMissing } from "@/components/config-missing";
import { QuickAdd } from "@/components/quick-add";
import { getPublicEnv } from "@/lib/env";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  const session = await requireOnboardedSession();
  const scope = financeScope(session);

  // Tudo em paralelo: contas e categorias do registo rápido e o contador de notificações
  // (count com o índice parcial notifications_unread_idx; o RLS já filtra por pessoa e permissão).
  const [accounts, categories, unreadRes] = await Promise.all([
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
    session.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  const unread = unreadRes.count;
  const overlay = scope.canWrite ? (
    <QuickAdd
      m={m}
      accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
      categories={(categories.data ?? []).map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
      today={todayIn(scope.timezone)}
    />
  ) : null;

  return (
    <AppShell m={m} session={session} overlay={overlay} unread={unread ?? 0} canQuickAdd={scope.canWrite && (accounts.data ?? []).length > 0}>
      {children}
    </AppShell>
  );
}
