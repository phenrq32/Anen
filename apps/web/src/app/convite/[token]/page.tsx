import type { Metadata } from "next";
import { format, formatDate, lookup } from "@anen/i18n";
import { ConfigMissing } from "@/components/config-missing";
import { Alert, ButtonLink, Logo } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Convite", referrer: "no-referrer" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { m, locale } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  const { token } = await params;
  const valid = /^[0-9a-f]{64}$/.test(token);
  const supabase = await createClient();
  const preview = valid ? (await supabase.rpc("get_invitation", { p_token: token })).data?.[0] : undefined;
  const session = await getSession();
  const roleName = preview ? (lookup(m.roles.names, preview.role_key) ?? preview.role_name) : "";
  const next = encodeURIComponent(`/convite/${token}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-8 px-4 py-12">
      <Logo className="h-7 w-auto self-start" />
      {!preview ? (
        <Alert tone="error">{m.invite.invalid}</Alert>
      ) : (
        <div className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">{format(m.invite.title, { organization: preview.organization_name })}</h1>
            <p className="text-muted">{format(m.invite.body, { role: roleName, email: preview.email })}</p>
            <p className="text-xs text-subtle">
              {format(m.members.expires, { date: formatDate(preview.expires_at, locale, session?.preferences.timezone ?? "Europe/Lisbon") })}
            </p>
          </div>
          {session ? (
            <AcceptInvitationForm m={m} token={token} />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{m.invite.signInFirst}</p>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/entrar?next=${next}`}>{m.auth.signIn.submit}</ButtonLink>
                <ButtonLink href={`/criar-conta?next=${next}`} variant="secondary">
                  {m.auth.signIn.createAccount}
                </ButtonLink>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
