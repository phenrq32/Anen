import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

const password = "Segura12345e2e";
const created: string[] = [];
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

test("plano do mês: salário, despesas fixas editáveis e orientação para a sobra", async ({ page }, info) => {
  test.setTimeout(150_000);
  const email = `e2e-plano-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Joana Plano"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/financas/plano");
  await expect(main.getByText("Indique o salário do mês para ver o resumo e a orientação.")).toBeVisible();

  // Despesas fixas: 650 + 200 + 150 = 1000 €
  for (const [name, amount] of [["Renda", "650"], ["Supermercado", "200"], ["Transportes", "150"]] as const) {
    await main.getByLabel("Despesa", { exact: true }).fill(name);
    await main.getByLabel("Valor mensal", { exact: true }).fill(amount);
    await main.getByRole("button", { name: "Adicionar despesa fixa" }).click();
    await expect(main.getByLabel(`Valor mensal: ${name}`)).toBeVisible();
  }

  // Salário de 1500 €, sem reserva → sobra 500 €: 400 € reserva, 100 € longo prazo
  await main.getByLabel(/Salário líquido do mês/).fill("1500");
  await main.getByRole("button", { name: "Guardar plano" }).click();
  await expect(main.getByText("Plano guardado.")).toBeVisible();
  await expect(main.getByText("Onde colocar a sobra")).toBeVisible();
  await expect(main.getByText("400,00 €").first()).toBeVisible();
  await expect(main.getByText("100,00 €").first()).toBeVisible();
  await expect(main.getByText("67% do salário vai para despesas fixas.").first()).toBeVisible();
  await expect(main.getByText("Conta poupança")).toBeVisible();
  await expect(main.getByText(/Não é uma recomendação personalizada/)).toBeVisible();

  // Alterar o valor da renda para 1450 € → défice de 300 €
  await main.getByLabel("Valor mensal: Renda").fill("1450");
  await main.getByRole("button", { name: "Atualizar" }).first().click();
  await expect(main.getByText("As despesas fixas são maiores do que o salário")).toBeVisible();
  await expect(main.getByText("Faltam 300,00 €")).toBeVisible();
  await expect(main.getByText("Onde colocar a sobra")).toHaveCount(0);
});
