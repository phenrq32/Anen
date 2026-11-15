import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Recuperar acesso" };

export default async function ForgotPasswordPage() {
  const { m } = await getI18n();
  return <ForgotPasswordForm m={m} />;
}
