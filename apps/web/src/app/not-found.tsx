import { ButtonLink, Logo } from "@/components/ui";
import { getI18n } from "@/lib/i18n";

export default async function NotFound() {
  const { m } = await getI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <Logo className="h-7 w-auto self-start" />
      <div>
        <p className="tabular text-sm font-semibold text-brand">404</p>
        <h1 className="mt-2 text-2xl font-bold">{m.errors.notFound}</h1>
        <p className="mt-2 text-muted">{m.errors.notFoundBody}</p>
      </div>
      <ButtonLink href="/painel" className="self-start">
        {m.errors.goHome}
      </ButtonLink>
    </main>
  );
}
