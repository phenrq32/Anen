"use client";

import { useEffect } from "react";

// Sem acesso ao idioma do servidor aqui: mensagem neutra, válida em pt-PT e pt-BR.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Ocorreu um erro</h1>
      <p className="text-muted">Não foi possível carregar esta página. Tente novamente.</p>
      {error.digest ? <p className="font-mono text-xs text-subtle">Ref.: {error.digest}</p> : null}
      <button
        onClick={reset}
        className="h-11 self-start rounded-md bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
      >
        Tentar novamente
      </button>
    </main>
  );
}
