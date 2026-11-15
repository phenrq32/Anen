import type { Messages } from "@anen/i18n";
import { Logo } from "@/components/ui";

export function ConfigMissing({ m }: { m: Messages }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-12">
      <Logo className="h-7 w-auto self-start" />
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-6">
        <h1 className="text-lg font-bold text-warning">{m.errors.configMissingTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{m.errors.configMissingBody}</p>
      </div>
    </main>
  );
}
