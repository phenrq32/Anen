import { ConfigMissing } from "@/components/config-missing";
import { Logo } from "@/components/ui";
import { getPublicEnv } from "@/lib/env";
import { getI18n } from "@/lib/i18n";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getI18n();
  if (!getPublicEnv()) return <ConfigMissing m={m} />;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-12 lg:flex">
        <Logo className="h-8 w-auto self-start" />
        <div className="max-w-md">
          <p className="text-[34px] font-bold leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {m.auth.signIn.subtitle}
          </p>
          <div className="mt-10 h-px w-24 bg-brand" />
        </div>
        <svg className="pointer-events-none absolute -bottom-10 -right-10 w-[420px] opacity-[0.07]" viewBox="0 0 120 100" aria-hidden>
          <polyline points="6,90 36,58 58,76 99,25" fill="none" stroke="#FF851B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </aside>
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <Logo className="mb-10 h-7 w-auto self-start lg:hidden" />
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
