import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { checkWorkspaceKey, WORKSPACE_FIELD } from "@/lib/workspace";

/**
 * Primeira linha de cada ação que grava dados de um workspace (QA-03).
 * O formulário envia o workspace que estava no ecrã; se não coincidir com o workspace ativo
 * (outra aba mudou de contexto) ou se faltar, nada é gravado: a página é recarregada no painel
 * com um aviso. Recebe o FormData do formulário ou, nas ações chamadas com objetos, a chave enviada.
 */
export async function guardWorkspace(input: FormData | string | null | undefined): Promise<void> {
  const sent = input instanceof FormData ? input.get(WORKSPACE_FIELD) : input;
  const session = await getSession();
  if (!session) redirect("/entrar");
  if (checkWorkspaceKey(session, typeof sent === "string" ? sent : null) !== "ok") {
    revalidatePath("/", "layout");
    redirect("/painel?contexto=alterado");
  }
}
