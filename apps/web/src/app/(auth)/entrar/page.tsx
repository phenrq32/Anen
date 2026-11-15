import type { Metadata } from "next";
import { safeNextPath } from "@anen/validation";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { SignInForm } from "../auth-forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m } = await getI18n();
  const params = await searchParams;
  const notice =
    params.erro === "confirmacao" ? m.auth.confirmFailed : params.erro === "sessao" ? m.errors.unauthorized : undefined;
  return (
    <SignInForm
      m={m}
      next={safeNextPath(params.next)}
      googleEnabled={getPublicEnv()?.googleAuthEnabled ?? false}
      {...(notice ? { notice } : {})}
    />
  );
}
