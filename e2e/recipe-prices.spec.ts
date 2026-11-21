import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Prompt 03 · Fase 5: fichas técnicas ligadas aos preços registados de fornecedores.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("ficha técnica com preço de fornecedor: conversão kg → g, aviso de preço novo e atualização", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-ficha-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Chef Preços"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Fornecedor com o preço da farinha ao quilo.
  await page.goto("/contactos");
  await main.getByLabel("Tipo", { exact: true }).selectOption("supplier");
  await main.getByLabel("Nome", { exact: true }).fill("Moagem Central");
  await main.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
  const supplierUrl = page.url();
  const addPrice = async (price: string, date: string) => {
    await main.getByLabel("Artigo", { exact: true }).fill("Farinha T65");
    await main.getByLabel(/^Unidade/).fill("kg");
    await main.getByLabel("Preço unitário").fill(price);
    await main.getByLabel("Data do preço").fill(date);
    await main.getByRole("button", { name: "Registar preço" }).click();
    await expect(main.getByText("Preço registado.")).toBeVisible();
  };
  await addPrice("1,00", "2026-10-01");

  // Ficha: o ingrediente usa o preço registado; 500 g a 1,00 €/kg = 0,50 €.
  await page.goto("/restauracao");
  await main.getByLabel("Prato").fill("Pão rústico");
  await main.getByRole("button", { name: "Nova ficha técnica" }).click();
  await page.waitForURL(/\/restauracao\/[0-9a-f-]{36}$/);
  const recipeUrl = page.url();
  await main.getByLabel("Doses").fill("10");
  await main.getByRole("button", { name: "+ Adicionar ingrediente" }).click();
  await main.getByLabel("Qtd. usada").first().fill("500");
  const source = main.getByLabel("Preço registado").first();
  const optionValue = await source.locator("option", { hasText: "Moagem Central · Farinha T65" }).getAttribute("value");
  await source.selectOption(optionValue!);
  await expect(main.getByLabel("Ingrediente", { exact: true }).first()).toHaveValue("Farinha T65");
  await expect(main.getByLabel("Qtd. embalagem").first()).toHaveValue("1000");
  await expect(main.getByLabel("Preço embalagem").first()).toHaveValue("1,00");
  await expect(main.getByLabel("Preço embalagem").first()).toHaveAttribute("readonly", "");
  await expect(main.getByText("0,50 €").first()).toBeVisible();
  await expect(main.getByText(/Preço de Moagem Central de/)).toBeVisible();
  await main.getByRole("button", { name: "Guardar ficha" }).click();
  await expect(main.getByText("Ficha guardada.")).toBeVisible();

  // Preço novo no fornecedor: a lista e a ficha avisam, sem mudar o custo sozinhas.
  await page.goto(supplierUrl);
  await addPrice("1,20", "2026-11-15");
  await page.goto("/restauracao");
  await expect(main.getByText("Preços novos")).toBeVisible();
  await page.goto(recipeUrl);
  await expect(main.getByText(/Moagem Central tem um preço mais recente: 1,20\s€/)).toBeVisible();
  await expect(main.getByText("0,50 €").first()).toBeVisible();
  await main.getByRole("button", { name: "Atualizar todos" }).click();
  await expect(main.getByLabel("Preço embalagem").first()).toHaveValue("1,20");
  await expect(main.getByText("0,60 €").first()).toBeVisible();
  await main.getByRole("button", { name: "Guardar ficha" }).click();
  await expect(main.getByText("Ficha guardada.")).toBeVisible();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);

  await page.reload();
  await expect(main.getByText(/tem um preço mais recente/)).toHaveCount(0);
  await expect(main.getByText("Evolução do custo por dose")).toBeVisible();
  await page.goto("/restauracao");
  await expect(main.getByText("Preços novos")).toHaveCount(0);
});
