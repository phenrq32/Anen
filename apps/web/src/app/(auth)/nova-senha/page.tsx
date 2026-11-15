import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Nova palavra-passe" };

// Acedida a partir do link de recuperação, que cria uma sessão temporária em /auth/confirm.
export default async function ResetPasswordPage() {
  const { m } = await getI18n();
  const session = await getSession();
  if (!session) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[26px] font-bold">{m.auth.reset.title}</h1>
        <Alert tone="error">{m.auth.reset.expired}</Alert>
        <Link href="/recuperar-acesso" className="text-sm font-medium text-brand hover:underline">
          {m.auth.forgot.submit}
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm m={m} />;
}
