import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Prompt 03 · Fase 8: inventário, reposição, encomendas, receção e comparação de fornecedores.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("inventário com custo médio, reposição automática, encomenda recebida com despesa e comparação de fornecedores", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-compras-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Gestora Compras"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Conta e dois fornecedores.
  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("1000");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();
  for (const [name, days] of [["Moagem Central", "30"], ["Grossista Norte", ""]] as const) {
    await page.goto("/contactos");
    await main.getByLabel("Tipo", { exact: true }).selectOption("supplier");
    await main.getByLabel("Nome", { exact: true }).fill(name);
    if (days) await main.getByLabel("Prazo de pagamento (dias)").fill(days);
    await main.getByRole("button", { name: "Guardar" }).click();
    await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
  }

  // Artigo com mínimo 20 kg e reposição até 50 kg.
  await page.goto("/inventario");
  await expect(main.getByText("Ainda não há artigos em stock.")).toBeVisible();
  await main.getByLabel("Artigo", { exact: true }).fill("Farinha T55");
  await main.getByLabel(/^Unidade/).fill("kg");
  await main.getByLabel("Stock mínimo").fill("20");
  await main.getByLabel(/^Repor até/).fill("50");
  await main.getByLabel(/^Fornecedor habitual/).selectOption({ label: "Moagem Central" });
  await main.getByRole("button", { name: "Criar artigo" }).click();
  await page.waitForURL(/\/inventario\/[0-9a-f-]{36}$/);
  const itemUrl = page.url();

  // Entrada de 10 kg a 1,00 €; saída de 4 kg; saída acima do saldo recusada.
  await main.getByLabel("Quantidade (kg)").fill("10");
  await main.getByLabel("Custo unitário / kg").fill("1,00");
  await main.getByRole("button", { name: "Registar movimento" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  await expect(main.getByText(/^1,00\s€ \/ kg$/)).toBeVisible();
  await main.getByLabel("Tipo", { exact: true }).selectOption("out");
  await expect(main.getByLabel("Custo unitário / kg")).toHaveCount(0);
  await main.getByLabel("Quantidade (kg)").fill("100");
  await main.getByRole("button", { name: "Registar movimento" }).click();
  await expect(main.getByText("Não há quantidade suficiente em stock.")).toBeVisible();
  await main.getByLabel("Quantidade (kg)").fill("4");
  await main.getByRole("button", { name: "Registar movimento" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  await expect(main.getByText("6 kg", { exact: true })).toBeVisible();
  await expect(main.getByText("Abaixo do mínimo").first()).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // Reposição: 50 − 6 = 44 kg, rascunho criado para o fornecedor habitual.
  await page.goto("/inventario");
  const reorder = main.getByRole("list", { name: "Reposição" });
  await expect(reorder.getByText("Farinha T55")).toBeVisible();
  await expect(reorder.getByText("44 kg")).toBeVisible();
  await main.getByRole("button", { name: "Criar rascunhos de encomenda" }).click();
  await page.waitForURL(/\/compras\?estado=draft/);
  await expect(main.getByText(/1 rascunho\(s\) com 1 artigo\(s\)/)).toBeVisible();
  await page.goto("/inventario");
  await expect(main.getByText("Nenhum artigo abaixo do mínimo.")).toBeVisible();

  // Encomenda: o rascunho vem sem preço; substitui-se a linha e junta-se um artigo que não entra no stock.
  await page.goto("/compras?estado=draft");
  await main.getByRole("link", { name: /Moagem Central/ }).click();
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
  await expect(main.getByText("Sem preço", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Remover" }).click();
  await expect(main.getByText("Ainda não há artigos nesta encomenda.")).toBeVisible();
  await main.getByLabel("Artigo de stock").selectOption({ label: "Farinha T55 (kg)" });
  await main.getByLabel("Quantidade", { exact: true }).fill("44");
  await main.getByLabel("Preço unitário").fill("1,20");
  await main.getByRole("button", { name: "Adicionar artigo" }).click();
  await expect(main.getByText("Artigo adicionado.")).toBeVisible();
  await main.getByLabel("Artigo de stock").selectOption({ label: "Não entra no stock" });
  await main.getByLabel("Descrição", { exact: true }).fill("Sacos de papel");
  await main.getByLabel("Quantidade", { exact: true }).fill("100");
  await main.getByLabel(/^Unidade/).fill("un");
  await main.getByLabel("Preço unitário").fill("0,05");
  await main.getByRole("button", { name: "Adicionar artigo" }).click();
  await expect(main.getByRole("cell", { name: "Sacos de papel" })).toBeVisible();
  await expect(main.getByText(/^57,80\s€$/)).toBeVisible();
  await main.getByRole("button", { name: "Marcar como encomendada" }).click();
  await expect(main.getByText("Encomendada", { exact: true })).toBeVisible();

  // Receção com despesa por pagar.
  await main.getByLabel(/^Data de receção/).fill("2026-11-20");
  await main.getByLabel(/^Conta da despesa/).selectOption({ label: "Banco" });
  await main.getByLabel(/Já está paga/).uncheck();
  await main.getByRole("button", { name: "Receber encomenda" }).click();
  await expect(main.getByText("Recebida", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Adicionar artigo" })).toHaveCount(0);
  await main.getByRole("link", { name: "Ver a despesa" }).click();
  await expect(main.getByText("Compra a Moagem Central").first()).toBeVisible();
  await expect(main.getByText(/57,80\s€/).first()).toBeVisible();

  // Stock: 6 kg a 1,00 € + 44 kg a 1,20 € = 50 kg a 1,176 € → 1,18 €.
  await page.goto(itemUrl);
  await expect(main.getByText("50 kg", { exact: true })).toBeVisible();
  await expect(main.getByText(/^1,18\s€ \/ kg$/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Encomenda" })).toBeVisible();

  // Segundo fornecedor, mais barato, recebido sem despesa: a comparação mostra os dois.
  await page.goto("/compras");
  await main.getByLabel("Fornecedor", { exact: true }).selectOption({ label: "Grossista Norte" });
  await main.getByRole("button", { name: "Criar encomenda" }).click();
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
  await main.getByLabel("Artigo de stock").selectOption({ label: "Farinha T55 (kg)" });
  await main.getByLabel("Quantidade", { exact: true }).fill("10");
  await main.getByLabel("Preço unitário").fill("1,10");
  await main.getByRole("button", { name: "Adicionar artigo" }).click();
  await expect(main.getByText("Artigo adicionado.")).toBeVisible();
  await main.getByLabel(/^Conta da despesa/).selectOption({ label: "Não registar despesa" });
  await main.getByRole("button", { name: "Receber encomenda" }).click();
  await expect(main.getByText("Recebida", { exact: true })).toBeVisible();

  await page.goto("/compras");
  const compare = main.getByRole("list", { name: "Comparar fornecedores" });
  await expect(compare.getByText("Farinha T55 · kg")).toBeVisible();
  const rows = compare.locator("ol > li");
  await expect(rows.nth(0)).toContainText("Grossista Norte");
  await expect(rows.nth(0)).toContainText("Mais barato");
  await expect(rows.nth(1)).toContainText("Moagem Central");
  await expect(rows.nth(1)).toContainText(/\+0,10\s€ que o mais barato/);
  expect(await noOverflow(page)).toBe(true);
});
