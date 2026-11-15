import type { Metadata } from "next";
import { safeNextPath } from "@anen/validation";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m } = await getI18n();
  const params = await searchParams;
  return <SignUpForm m={m} next={safeNextPath(params.next, "/boas-vindas")} googleEnabled={getPublicEnv()?.googleAuthEnabled ?? false} />;
}
