import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// Revisão de 23/11/2026: apagar orçamentos (um, vários, em qualquer estado), acessibilidade e áreas do menu.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("apagar orçamentos, acessibilidade e áreas do menu", async ({ page, context, isMobile }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-revisao-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rita Revisão"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Três orçamentos; um deles enviado (antes só os rascunhos se podiam apagar).
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.goto("/orcamentos/novo");
    await page.getByRole("button", { name: /^Pintura/ }).click();
    await page.waitForURL(/\/orcamentos\/[0-9a-f-]{36}$/);
    ids.push(page.url().split("/").pop()!);
  }
  await main.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(main.getByRole("button", { name: "Marcar como aceite" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await main.getByRole("button", { name: "Apagar orçamento" }).click();
  await page.waitForURL(/\/orcamentos\?apagados=1$/);
  await expect(main.getByText("1 orçamento(s) apagado(s).")).toBeVisible();

  // Vários de uma vez pela lista.
  await expect(main.getByRole("checkbox", { name: /^Selecionar ORC-/ })).toHaveCount(2);
  await expect(main.getByRole("button", { name: "Apagar selecionados" })).toBeHidden();
  await main.getByText("Selecionar todos").click();
  await expect(main.getByText("2 selecionado(s)")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await main.getByRole("button", { name: "Apagar selecionados" }).click();
  await page.waitForURL(/apagados=2/);
  await expect(main.getByText("Ainda não há orçamentos.")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // Acessibilidade: liga na hora e fica no aparelho.
  await page.goto("/definicoes#acessibilidade");
  const html = page.locator("html");
  await main.getByRole("switch", { name: /Reduzir animações/ }).check({ force: true });
  await main.getByRole("switch", { name: /Alto contraste/ }).check({ force: true });
  await main.getByRole("switch", { name: /Letra de leitura fácil/ }).check({ force: true });
  await expect(html).toHaveAttribute("data-motion", "reduce");
  await expect(html).toHaveAttribute("data-contrast", "high");
  await expect(html).toHaveAttribute("data-font", "readable");
  expect((await context.cookies()).find((c) => c.name === "anen-a11y")?.value).toBe(encodeURIComponent("motion,contrast,font"));
  await page.reload();
  await expect(html).toHaveAttribute("data-contrast", "high");
  await main.getByRole("switch", { name: /Alto contraste/ }).uncheck({ force: true });
  await expect(html).not.toHaveAttribute("data-contrast", "high");

  // Áreas do menu: a Ficha técnica começa escondida; esconder o Mercado tira-o do menu.
  const nav = isMobile ? null : page.locator("aside");
  if (nav) {
    await expect(nav.getByRole("link", { name: "Fichas técnicas" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Mercado" })).toBeVisible();
  }
  await expect(main.getByRole("checkbox", { name: /Fichas técnicas/ })).not.toBeChecked();
  await main.getByRole("checkbox", { name: /Fichas técnicas/ }).check();
  await main.getByRole("checkbox", { name: /^Mercado/ }).uncheck();
  await main.getByRole("button", { name: "Guardar áreas" }).click();
  await expect(main.getByText("Áreas do menu guardadas.")).toBeVisible();
  await page.reload();
  if (nav) {
    await expect(nav.getByRole("link", { name: "Fichas técnicas" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Mercado" })).toHaveCount(0);
  }
  // A página continua a abrir pelo endereço.
  await page.goto("/mercado");
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});
