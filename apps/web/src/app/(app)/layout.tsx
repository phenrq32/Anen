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

  let overlay: React.ReactNode = null;
  if (scope.canWrite) {
    const [accounts, categories] = await Promise.all([
      session.supabase.from("financial_accounts").select("id, name, currency_code").eq(scope.column, scope.value).is("archived_at", null).order("name"),
      session.supabase
        .from("transaction_categories")
        .select("id, key, name, kind, is_system")
        .or(`is_system.eq.true,${scope.column}.eq.${scope.value}`)
        .is("archived_at", null)
        .order("name"),
    ]);
    overlay = (
      <QuickAdd
        m={m}
        accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency_code }))}
        categories={(categories.data ?? []).map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind }))}
        today={todayIn(scope.timezone)}
      />
    );
  }

  // Um count com índice parcial (notifications_unread_idx); o RLS já filtra por pessoa e permissão.
  const { count: unread } = await session.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);

  return (
    <AppShell m={m} session={session} overlay={overlay} unread={unread ?? 0}>
      {children}
    </AppShell>
  );
}
