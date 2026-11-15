import { AppShell } from "@/components/app-shell";
import { ConfigMissing } from "@/components/config-missing";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  const session = await requireOnboardedSession();
  return (
    <AppShell m={m} session={session}>
      {children}
    </AppShell>
  );
}
