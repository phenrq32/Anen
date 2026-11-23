import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";
import { openQuickAdd } from "./ui";

const password = "Segura12345e2e";
const created: string[] = [];

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

async function onboardPersonal(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page).toHaveURL(/\/painel/);
}

test("finanças pessoais: conta, registo rápido, movimentos, orçamento e exportação", async ({ page }, info) => {
  const email = `e2e-fin-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Marta Finanças"));
  await onboardPersonal(page, email);
  const main = page.getByRole("main");

  // Sem contas: estado vazio com chamada para ação
  await expect(main.getByText("Comece por criar uma conta")).toBeVisible();
  await main.getByRole("link", { name: "Nova conta" }).click();
  await expect(page).toHaveURL(/\/financas\/contas/);
  await page.getByLabel("Nome", { exact: true }).fill("Conta principal");
  await page.getByLabel("Saldo inicial").fill("1.000,00");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Conta principal")).toBeVisible();
  await expect(main.getByText("1000,00 €").first()).toBeVisible();

  // Registo rápido com a tecla N (após recarregar, o layout já conhece a conta)
  await page.goto("/financas");
  await openQuickAdd(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Registo rápido" })).toBeVisible();
  await dialog.getByLabel(/Valor/).fill("12,345");
  await dialog.getByLabel("Descrição").fill("Supermercado");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("Valor inválido.", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Descrição")).toHaveValue("Supermercado");
  await dialog.getByLabel(/Valor/).fill("45,90");
  await dialog.getByLabel("Categoria").selectOption({ label: "Alimentação" });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("«Supermercado»")).toBeVisible();
  await expect(dialog.getByLabel("Descrição")).toHaveValue(""); // pronto para o próximo
  await dialog.getByText("Receita", { exact: true }).click();
  await dialog.getByLabel(/Valor/).fill("250");
  await dialog.getByLabel("Descrição").fill("Trabalho extra");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("«Trabalho extra»")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).first().click();

  // Resumo reflete os valores exatos
  await page.reload();
  await expect(main.getByText("Supermercado")).toBeVisible();
  // Valores exatos lidos pelo leitor de ecrã (o número visível é animado): saldo, receitas, despesas, resultado
  const kpis = (await main.locator(".sr-only").allTextContents()).map((t) => t.replace(/\s/g, " "));
  expect(kpis.slice(0, 4)).toEqual(["1204,10 €", "250,00 €", "45,90 €", "204,10 €"]);
  await expect(main.getByText("Margem do mês: 81,6 %")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Despesas por categoria" })).toBeVisible();
  await expect(main.getByText("Alimentação").first()).toBeVisible();

  // Orçamento excedido
  await page.goto("/financas/orcamentos");
  await page.getByLabel("Categoria de despesa").selectOption({ label: "Alimentação" });
  await page.getByLabel("Limite mensal").fill("40");
  await page.getByRole("button", { name: "Definir orçamento" }).click();
  await expect(main.getByText(/Excedido em 5,90/)).toBeVisible();

  // Movimentos: filtro e exportação CSV
  await page.goto("/financas/movimentos?tipo=expense");
  await expect(main.getByText("Supermercado")).toBeVisible();
  await expect(main.getByText("Trabalho extra")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await main.getByRole("link", { name: "Exportar CSV" }).click();
  const file = await download;
  const content = await (await file.createReadStream()).toArray();
  const csv = Buffer.concat(content).toString("utf8");
  expect(csv).toContain('"Supermercado"');
  expect(csv).toContain('"-45.90"');
});
