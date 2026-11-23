import { expect, type Page } from "@playwright/test";

/**
 * Abre o registo rápido com a tecla N. O atalho só existe depois de a página ficar interativa;
 * em produção isso pode demorar um pouco mais do que o carregamento (QA-16), por isso repete-se
 * a tecla até o diálogo abrir (sem repetir depois de aberto).
 */
export async function openQuickAdd(page: Page) {
  const heading = page.getByRole("dialog").getByRole("heading", { name: "Registo rápido" });
  await expect(async () => {
    if (!(await heading.isVisible())) await page.keyboard.press("n");
    await expect(heading).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
}
