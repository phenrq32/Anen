import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Aparência (tema claro/escuro/automático e tamanho do texto) e tour de boas-vindas.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("tour de boas-vindas e aparência (tema claro, letra grande) guardada no aparelho", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-aparencia-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rosa Lima"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);

  // Tour (o automático não abre em navegador de testes; ?tour=1 abre como em Definições)
  await page.goto("/painel?tour=1");
  const welcome = page.getByRole("dialog", { name: "Bem-vindo à ANEN" });
  await expect(welcome).toBeVisible({ timeout: 10_000 });
  await welcome.getByRole("button", { name: "Mostrar-me" }).click();
  const tour = page.getByRole("dialog").filter({ hasText: /Passo 1 de \d+/ });
  await expect(tour).toBeVisible();
  // percorre até ao fim; cada passo destaca uma parte que existe nesta conta
  for (let i = 0; i < 10; i++) {
    const done = page.getByRole("button", { name: "Começar a usar" });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await page.getByRole("button", { name: "Próximo" }).click();
  }
  await expect(page.getByRole("dialog").filter({ hasText: /Passo \d+ de \d+/ })).toHaveCount(0);
  expect((await context.cookies()).find((c) => c.name === "anen-tour")?.value).toBe("done");
  await expect(page).toHaveURL(/\/painel$/);                       // tira o ?tour=1

  // Aparência: muda na hora e fica guardada neste aparelho
  await page.goto("/definicoes");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByText("Claro", { exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByText("Grande", { exact: true }).click();
  await expect(html).toHaveAttribute("data-text", "large");
  await expect(page.getByText("Guardado neste aparelho.")).toBeVisible();
  // o fundo ficou claro de verdade
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(245, 244, 241)");

  await page.goto("/painel");                                       // o servidor já desenha com a escolha
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-text", "large");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // procura (Ctrl+K) leva à Aparência
  await page.keyboard.press("Control+k");
  await page.keyboard.type("aparência");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/definicoes/);

  // volta ao escuro e normal
  await page.getByText("Escuro", { exact: true }).click();
  await page.getByText("Normal", { exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-text", "normal");
});
