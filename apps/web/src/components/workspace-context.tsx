"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WORKSPACE_FIELD } from "@/lib/workspace";

const WorkspaceKeyContext = createContext<string | null>(null);

/**
 * Guarda a chave do workspace com que a página foi desenhada ("personal" ou "org:<id>").
 * Os formulários enviam-na e o servidor recusa gravar se, entretanto, outra aba mudou o workspace ativo.
 */
export function WorkspaceKeyProvider({ value, children }: { value: string; children: ReactNode }) {
  return <WorkspaceKeyContext.Provider value={value}>{children}</WorkspaceKeyContext.Provider>;
}

export function useWorkspaceKey(): string | null {
  return useContext(WorkspaceKeyContext);
}

/** Campo oculto para formulários que chamam ações do servidor. Fora da área autenticada não desenha nada. */
export function WorkspaceField() {
  const key = useWorkspaceKey();
  return key ? <input type="hidden" name={WORKSPACE_FIELD} value={key} /> : null;
}
