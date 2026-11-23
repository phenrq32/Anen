/**
 * Memória de categorias: a última categoria que a pessoa usou para a mesma descrição (e o mesmo tipo)
 * é sugerida no próximo registo. Determinístico, só com os registos da própria pessoa/organização.
 */
export interface MemoryRow {
  description: string;
  kind: "income" | "expense";
  category_id: string | null;
}

/** "Supermercado Pingo Doce 12/11" e "supermercado pingo doce" dão a mesma chave. */
export function descriptionKey(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Linhas do mais recente para o mais antigo: a primeira categoria encontrada para cada chave fica. */
export function buildCategoryMemory(rows: readonly MemoryRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!r.category_id) continue;
    const key = descriptionKey(r.description);
    if (key.length < 2) continue;
    const k = `${r.kind}|${key}`;
    if (!(k in out)) out[k] = r.category_id;
  }
  return out;
}

export function suggestCategory(memory: Record<string, string>, kind: "income" | "expense", description: string): string | null {
  const key = descriptionKey(description);
  return key.length < 2 ? null : (memory[`${kind}|${key}`] ?? null);
}
