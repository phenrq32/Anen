import { redirect } from "next/navigation";
import { ConfigMissing } from "@/components/config-missing";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";

export default async function Home() {
  if (!getPublicEnv()) {
    const { m } = await getI18n();
    return <ConfigMissing m={m} />;
  }
  const session = await getSession();
  if (!session) redirect("/entrar");
  redirect(session.profile.onboarded_at ? "/painel" : "/boas-vindas");
}
